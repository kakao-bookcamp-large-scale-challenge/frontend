import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import authService from './authService';
import { Toast } from '../components/Toast';

class FileService {
  constructor() {
    this.baseUrl = process.env.NEXT_PUBLIC_API_URL;
    this.uploadLimit = 50 * 1024 * 1024; // 50MB
    this.retryAttempts = 3;
    this.retryDelay = 1000;
    this.activeUploads = new Map();

    // S3 설정
    this.bucketName = process.env.NEXT_PUBLIC_S3_BUCKET_NAME;
    this.region = process.env.NEXT_PUBLIC_AWS_REGION || 'ap-northeast-2';
    this.bucketUrl = process.env.NEXT_PUBLIC_S3_BUCKET_URL || 
                     `https://${this.bucketName}.s3.${this.region}.amazonaws.com`;
    this.cloudFrontDomain = process.env.NEXT_PUBLIC_CLOUDFRONT_DOMAIN;

    this.allowedTypes = {
      image: {
        extensions: ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
        mimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
        maxSize: 10 * 1024 * 1024,
        name: '이미지',
        folder: 'images'
      },
      video: {
        extensions: ['.mp4', '.webm', '.mov'],
        mimeTypes: ['video/mp4', 'video/webm', 'video/quicktime'],
        maxSize: 50 * 1024 * 1024,
        name: '동영상',
        folder: 'videos'
      },
      audio: {
        extensions: ['.mp3', '.wav', '.ogg'],
        mimeTypes: ['audio/mpeg', 'audio/wav', 'audio/ogg'],
        maxSize: 20 * 1024 * 1024,
        name: '오디오',
        folder: 'audio'
      },
      document: {
        extensions: ['.pdf', '.doc', '.docx', '.txt'],
        mimeTypes: [
          'application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'text/plain'
        ],
        maxSize: 20 * 1024 * 1024,
        name: '문서',
        folder: 'documents'
      },
      archive: {
        extensions: ['.zip', '.rar', '.7z'],
        mimeTypes: [
          'application/zip',
          'application/x-rar-compressed',
          'application/x-7z-compressed'
        ],
        maxSize: 50 * 1024 * 1024,
        name: '압축파일',
        folder: 'archives'
      }
    };

    console.log('FileService initialized:', {
      bucketName: this.bucketName,
      bucketUrl: this.bucketUrl,
      hasCloudFront: !!this.cloudFrontDomain,
      baseUrl: this.baseUrl
    });
  }

  async validateFile(file) {
    if (!file) {
      const message = '파일이 선택되지 않았습니다.';
      Toast.error(message);
      return { success: false, message };
    }

    console.log('Validating file:', {
      name: file.name,
      type: file.type,
      size: file.size
    });

    if (file.size > this.uploadLimit) {
      const message = `파일 크기는 ${this.formatFileSize(this.uploadLimit)}를 초과할 수 없습니다.`;
      Toast.error(message);
      return { success: false, message };
    }

    let isAllowedType = false;
    let maxTypeSize = 0;
    let typeConfig = null;

    // MIME 타입으로 먼저 확인
    for (const config of Object.values(this.allowedTypes)) {
      if (config.mimeTypes.includes(file.type)) {
        isAllowedType = true;
        maxTypeSize = config.maxSize;
        typeConfig = config;
        break;
      }
    }

    // MIME 타입으로 찾지 못한 경우 확장자로 확인
    if (!isAllowedType) {
      const ext = this.getFileExtension(file.name).toLowerCase();
      for (const config of Object.values(this.allowedTypes)) {
        if (config.extensions.includes(ext)) {
          isAllowedType = true;
          maxTypeSize = config.maxSize;
          typeConfig = config;
          console.log('File type matched by extension:', ext, 'Config:', config);
          break;
        }
      }
    }

    if (!isAllowedType) {
      const supportedTypes = Object.values(this.allowedTypes)
        .map(config => config.name)
        .join(', ');
      const message = `지원하지 않는 파일 형식입니다. 지원 형식: ${supportedTypes}`;
      console.error('Unsupported file type:', {
        fileName: file.name,
        fileType: file.type,
        supportedTypes
      });
      Toast.error(message);
      return { success: false, message };
    }

    if (file.size > maxTypeSize) {
      const message = `${typeConfig.name} 파일은 ${this.formatFileSize(maxTypeSize)}를 초과할 수 없습니다.`;
      Toast.error(message);
      return { success: false, message };
    }

    const ext = this.getFileExtension(file.name).toLowerCase();
    if (!typeConfig.extensions.includes(ext)) {
      const message = `${typeConfig.name} 파일의 확장자가 올바르지 않습니다. 지원 확장자: ${typeConfig.extensions.join(', ')}`;
      console.error('Invalid file extension:', {
        fileName: file.name,
        fileExtension: ext,
        supportedExtensions: typeConfig.extensions
      });
      Toast.error(message);
      return { success: false, message };
    }

    console.log('File validation successful:', {
      name: file.name,
      type: file.type,
      size: file.size,
      typeConfig: typeConfig.name
    });

    return { success: true, typeConfig };
  }

  generateS3Key(file, typeConfig) {
    const timestamp = Date.now();
    const uuid = uuidv4();
    const ext = this.getFileExtension(file.name);
    const folder = typeConfig.folder || 'files';
    
    return `uploads/${folder}/${timestamp}-${uuid}${ext}`;
  }

  getS3Url(s3Key) {
    if (this.cloudFrontDomain) {
      return `https://${this.cloudFrontDomain}/${s3Key}`;
    } else {
      return `${this.bucketUrl}/${s3Key}`;
    }
  }

  async uploadToS3(file, s3Key, onProgress) {
    const s3Url = this.getS3Url(s3Key);
    
    console.log('Uploading to S3:', {
      s3Key,
      s3Url,
      fileSize: file.size,
      fileType: file.type,
      bucketName: this.bucketName,
      bucketUrl: this.bucketUrl
    });

    try {
      // S3에 직접 PUT 요청 (fetch 사용)
      const response = await fetch(s3Url, {
        method: 'PUT',
        headers: {
          'Content-Type': file.type,
        },
        body: file
      });

      if (!response.ok) {
        throw new Error(`S3 upload failed: ${response.status} ${response.statusText}`);
      }

      console.log('S3 upload successful:', {
        status: response.status,
        s3Key,
        s3Url
      });

      // 진행률 수동 업데이트 (fetch에서는 실시간 진행률이 어려움)
      if (onProgress) {
        onProgress(100);
      }

      return {
        success: true,
        s3Key,
        url: s3Url,
        etag: response.headers.get('etag')
      };

    } catch (error) {
      console.error('S3 upload error:', error);
      throw new Error(`S3 업로드 실패: ${error.message}`);
    }
  }

  async uploadFile(file, onProgress) {
    console.log('Starting file upload:', {
      name: file.name,
      type: file.type,
      size: file.size
    });

    const validationResult = await this.validateFile(file);
    if (!validationResult.success) {
      console.error('File validation failed:', validationResult);
      return validationResult;
    }

    try {
      const user = authService.getCurrentUser();
      if (!user?.token || !user?.sessionId) {
        const error = { 
          success: false, 
          message: '인증 정보가 없습니다.' 
        };
        console.error('Authentication failed:', error);
        return error;
      }

      // S3가 설정되어 있으면 S3 업로드, 아니면 기존 방식
      if (this.bucketName) {
        console.log('Using S3 upload method');
        return await this.uploadToS3Method(file, validationResult.typeConfig, onProgress);
      } else {
        console.log('S3 not configured, using legacy upload method');
        return await this.uploadToLegacyMethod(file, onProgress);
      }

    } catch (error) {
      console.error('File upload error:', error);
      
      if (error.name === 'AbortError') {
        return {
          success: false,
          message: '업로드가 취소되었습니다.'
        };
      }

      return this.handleUploadError(error);
    }
  }

  async uploadToS3Method(file, typeConfig, onProgress) {
    // S3에 파일 업로드
    const s3Key = this.generateS3Key(file, typeConfig);
    console.log('Generated S3 key:', s3Key);
    
    const s3UploadResult = await this.uploadToS3(file, s3Key, onProgress);
    
    if (!s3UploadResult.success) {
      console.error('S3 upload failed:', s3UploadResult);
      throw new Error('S3 업로드에 실패했습니다.');
    }

    console.log('S3 upload successful:', s3UploadResult);

    // 백엔드에 메타데이터만 저장
    const metadataPayload = {
      s3Key: s3UploadResult.s3Key,
      url: s3UploadResult.url,
      originalname: file.name,
      mimetype: file.type,
      size: file.size,
      etag: s3UploadResult.etag
    };

    console.log('Sending metadata to backend:', metadataPayload);

    const metadataResponse = await this.saveFileMetadata(metadataPayload);
    
    console.log('Metadata response from backend:', metadataResponse);

    if (!metadataResponse.success) {
      console.error('Metadata save failed:', metadataResponse);
      throw new Error(metadataResponse.message || '파일 메타데이터 저장에 실패했습니다.');
    }

    console.log('File upload completed successfully:', metadataResponse);

    return {
      success: true,
      data: {
        file: {
          _id: metadataResponse.data.file._id,
          filename: s3UploadResult.s3Key,
          originalname: file.name,
          mimetype: file.type,
          size: file.size,
          url: s3UploadResult.url,
          s3Key: s3UploadResult.s3Key
        }
      }
    };
  }

  async uploadToLegacyMethod(file, onProgress) {
    // 기존 백엔드 업로드 방식
    const formData = new FormData();
    formData.append('file', file);

    const uploadUrl = this.baseUrl ? 
      `${this.baseUrl}/api/files/upload` : 
      '/api/files/upload';

    const user = authService.getCurrentUser();

    const response = await axios.post(uploadUrl, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
        'x-auth-token': user.token,
        'x-session-id': user.sessionId
      },
      withCredentials: true,
      onUploadProgress: (progressEvent) => {
        if (onProgress) {
          const percentCompleted = Math.round(
            (progressEvent.loaded * 100) / progressEvent.total
          );
          onProgress(percentCompleted);
        }
      }
    });

    if (!response.data || !response.data.success) {
      return {
        success: false,
        message: response.data?.message || '파일 업로드에 실패했습니다.'
      };
    }

    const fileData = response.data.file;
    return {
      success: true,
      data: {
        ...response.data,
        file: {
          ...fileData,
          url: this.getFileUrl(fileData.filename, true)
        }
      }
    };
  }

  async saveFileMetadata(fileData) {
    try {
      const user = authService.getCurrentUser();
      const saveUrl = this.baseUrl ? 
        `${this.baseUrl}/api/files/metadata` : 
        '/api/files/metadata';

      const response = await axios.post(saveUrl, fileData, {
        headers: {
          'Content-Type': 'application/json',
          'x-auth-token': user.token,
          'x-session-id': user.sessionId
        },
        withCredentials: true
      });

      return response.data;
    } catch (error) {
      console.error('Metadata save error:', error);
      
      if (error.response?.status === 401) {
        try {
          const refreshed = await authService.refreshToken();
          if (refreshed) {
            return this.saveFileMetadata(fileData);
          }
          return {
            success: false,
            message: '인증이 만료되었습니다. 다시 로그인해주세요.'
          };
        } catch (refreshError) {
          return {
            success: false,
            message: '인증이 만료되었습니다. 다시 로그인해주세요.'
          };
        }
      }

      return {
        success: false,
        message: error.response?.data?.message || '메타데이터 저장에 실패했습니다.'
      };
    }
  }

  async downloadFile(s3Key, originalname) {
    try {
      const fileUrl = this.getS3Url(s3Key);
      
      console.log('Attempting to download file from S3:', { s3Key, fileUrl, originalname });

      const response = await fetch(fileUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`);
      }

      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = originalname || s3Key.split('/').pop(); // 원본 파일명 또는 S3 키에서 추출
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      URL.revokeObjectURL(blobUrl); // 임시 URL 해제

      console.log('File download initiated successfully:', { s3Key, originalname });
      
      return {
        success: true,
        message: '다운로드가 시작되었습니다.'
      };
    } catch (error) {
      console.error('Download error:', error);
      Toast.error(`다운로드에 실패했습니다: ${error.message}`);
      return {
        success: false,
        message: `다운로드에 실패했습니다: ${error.message}`
      };
    }
  }

  openInNewTab(s3Key) {
    try {
      const fileUrl = this.getS3Url(s3Key);
      window.open(fileUrl, '_blank');
      return {
        success: true,
        message: '새 탭에서 파일을 열었습니다.'
      };
    } catch (error) {
      console.error('Open in new tab error:', error);
      return {
        success: false,
        message: '파일을 열 수 없습니다.'
      };
    }
  }

  cancelUpload(filename) {
    const source = this.activeUploads.get(filename);
    if (source) {
      source.cancel('업로드가 사용자에 의해 취소되었습니다.');
      this.activeUploads.delete(filename);
      return true;
    }
    return false;
  }

  getFileUrl(s3Key, forPreview = false) {
    return this.getS3Url(s3Key);
  }

  getPreviewUrl(file, withAuth = false) {
    if (!file?.filename && !file?.s3Key) return '';
    
    const s3Key = file.s3Key || file.filename;
    return this.getS3Url(s3Key);
  }

  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  getFileExtension(filename) {
    return filename.substring(filename.lastIndexOf('.'));
  }

  getHeaders() {
    const user = authService.getCurrentUser();
    if (!user?.token || !user?.sessionId) {
      return {};
    }
    return {
      'x-auth-token': user.token,
      'x-session-id': user.sessionId,
      'Accept': 'application/json, */*'
    };
  }

  handleUploadError(error) {
    console.error('Upload error:', error);

    if (error.code === 'ECONNABORTED') {
      return {
        success: false,
        message: '파일 업로드 시간이 초과되었습니다.'
      };
    }

    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const message = error.response?.data?.message;

      switch (status) {
        case 400:
          return {
            success: false,
            message: message || '잘못된 요청입니다.'
          };
        case 401:
          return {
            success: false,
            message: '인증이 필요합니다.'
          };
        case 413:
          return {
            success: false,
            message: '파일이 너무 큽니다.'
          };
        case 415:
          return {
            success: false,
            message: '지원하지 않는 파일 형식입니다.'
          };
        case 500:
          return {
            success: false,
            message: '서버 오류가 발생했습니다.'
          };
        default:
          return {
            success: false,
            message: message || '파일 업로드에 실패했습니다.'
          };
      }
    }

    return {
      success: false,
      message: error.message || '알 수 없는 오류가 발생했습니다.',
      error
    };
  }

  async retryUpload(file, onProgress, attempt = 1) {
    if (attempt > this.retryAttempts) {
      throw new Error('최대 재시도 횟수를 초과했습니다.');
    }

    try {
      return await this.uploadFile(file, onProgress);
    } catch (error) {
      if (attempt < this.retryAttempts) {
        await new Promise(resolve => 
          setTimeout(resolve, this.retryDelay * attempt)
        );
        return this.retryUpload(file, onProgress, attempt + 1);
      }
      throw error;
    }
  }

  getFileTypeFromMime(mimeType) {
    for (const [type, config] of Object.entries(this.allowedTypes)) {
      if (config.mimeTypes.includes(mimeType)) {
        return type;
      }
    }
    return 'unknown';
  }

  isImageFile(file) {
    return this.allowedTypes.image.mimeTypes.includes(file.type || file.mimetype);
  }

  isVideoFile(file) {
    return this.allowedTypes.video.mimeTypes.includes(file.type || file.mimetype);
  }

  isAudioFile(file) {
    return this.allowedTypes.audio.mimeTypes.includes(file.type || file.mimetype);
  }

  isDocumentFile(file) {
    return this.allowedTypes.document.mimeTypes.includes(file.type || file.mimetype);
  }
}

const fileService = new FileService();
export default fileService;