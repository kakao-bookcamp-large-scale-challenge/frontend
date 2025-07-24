import React, { useState, useEffect } from 'react';
import { 
  PdfIcon as FileText, 
  ImageIcon as Image, 
  MovieIcon as Film, 
  CorrectOutlineIcon as CheckCheck, 
  CorrectOutlineIcon as Check, 
  SoundOnIcon,
  OpenInNewOutlineIcon,
  DownloadIcon as Download,
  ErrorCircleIcon as AlertCircle 
} from '@vapor-ui/icons';
import { Button, Text, Callout } from '@vapor-ui/core';
import PersistentAvatar from '../../common/PersistentAvatar';
import MessageContent from './MessageContent';
import MessageActions from './MessageActions';
import ReadStatus from '../ReadStatus';
import fileService from '../../../services/fileService';

const FileMessage = ({ 
  msg = {}, 
  isMine = false, 
  currentUser = null,
  onReactionAdd,
  onReactionRemove,
  onMessageDelete,
  room = null,
  messageRef,
  socketRef
}) => {
  const [error, setError] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');

  useEffect(() => {
    if (msg?.file) {
      console.log('FileMessage - File data received:', {
        fileData: msg.file,
        s3Key: msg.file.s3Key,
        filename: msg.file.filename,
        url: msg.file.url,
        storageType: msg.file.storageType
      });

      // S3 파일인 경우 직접 URL 사용, 로컬 파일인 경우 API URL 사용
      if (msg.file.storageType === 's3' && msg.file.url) {
        console.log('Using direct S3 URL:', msg.file.url);
        setPreviewUrl(msg.file.url);
      } else if (msg.file.path) {
        console.log('Using file path URL:', msg.file.path);
        setPreviewUrl(msg.file.path);
      } else {
        // 레거시 방식: API를 통한 파일 접근
        const apiUrl = `/api/files/view/${msg.file.filename}`;
        console.log('Using API URL:', apiUrl);
        setPreviewUrl(apiUrl);
      }
    }
  }, [msg?.file]);

  if (!msg?.file) {
    console.error('File data is missing:', msg);
    return null;
  }

  const formattedTime = new Date(msg.timestamp).toLocaleString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).replace(/\./g, '년').replace(/\s/g, ' ').replace('일 ', '일 ');

  const getFileIcon = () => {
    const mimetype = msg.file?.mimetype || '';
    const iconProps = { className: "w-5 h-5 flex-shrink-0" };

    if (mimetype.startsWith('image/')) return <Image {...iconProps} color="#00C853" />;
    if (mimetype.startsWith('video/')) return <Film {...iconProps} color="#2196F3" />;
    if (mimetype.startsWith('audio/')) return <SoundOnIcon {...iconProps} color="#9C27B0" />;
    return <FileText {...iconProps} color="#ffffff" />;
  };

  const getDecodedFilename = (filename) => {
    try {
      if (!filename) return 'Unknown File';
      
      // S3 key에서 파일명 추출 (폴더/timestamp-uuid.ext 형식)
      if (filename.includes('/')) {
        const parts = filename.split('/');
        const filenameWithUuid = parts[parts.length - 1];
        // timestamp-uuid.ext에서 확장자만 유지하고 원본 이름 사용
        if (msg.file.originalname) {
          return msg.file.originalname;
        }
        return filenameWithUuid;
      }

      // 기존 방식 유지 (하위 호환성)
      const base64 = filename
        .replace(/-/g, '+')
        .replace(/_/g, '/');
      
      const pad = base64.length % 4;
      const paddedBase64 = pad ? base64 + '='.repeat(4 - pad) : base64;
      
      if (paddedBase64.match(/^[A-Za-z0-9+/=]+$/)) {
        return Buffer.from(paddedBase64, 'base64').toString('utf8');
      }

      return decodeURIComponent(filename);
    } catch (error) {
      console.error('Filename decoding error:', error);
      return msg.file.originalname || filename;
    }
  };

  const renderAvatar = () => (
    <PersistentAvatar 
      user={isMine ? currentUser : msg.sender}
      size="md"
      className="flex-shrink-0"
      showInitials={true}
    />
  );

  const handleFileDownload = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setError(null);
    
    try {
      const s3Key = msg.file.s3Key || msg.file.filename;
      if (!s3Key) {
        throw new Error('파일 정보가 없습니다.');
      }

      const result = await fileService.downloadFile(s3Key, msg.file.originalname);
      
      if (!result.success) {
        throw new Error(result.message);
      }

    } catch (error) {
      console.error('File download error:', error);
      setError(error.message || '파일 다운로드 중 오류가 발생했습니다.');
    }
  };

  const handleViewInNewTab = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setError(null);

    try {
      const s3Key = msg.file.s3Key || msg.file.filename;
      if (!s3Key) {
        throw new Error('파일 정보가 없습니다.');
      }

      const result = fileService.openInNewTab(s3Key);
      
      if (!result.success) {
        throw new Error(result.message);
      }
    } catch (error) {
      console.error('File view error:', error);
      setError(error.message || '파일 보기 중 오류가 발생했습니다.');
    }
  };

  const renderImagePreview = (originalname) => {
    try {
      if (!previewUrl) {
        return (
          <div className="flex items-center justify-center h-full bg-gray-100">
            <Image className="w-8 h-8 text-gray-400" />
          </div>
        );
      }

      return (
        <div className="bg-transparent-pattern">
          <img 
            src={previewUrl}
            alt={originalname}
            className="object-cover rounded-sm"
            onLoad={() => {
              console.debug('Image loaded successfully:', originalname);
            }}
            onError={(e) => {
              console.error('Image load error:', {
                src: e.target.src,
                previewUrl,
                originalname,
                fileData: msg.file,
                error: e.error
              });
              e.target.onerror = null; 
              e.target.src = '/images/placeholder-image.png';
              setError(`이미지를 불러올 수 없습니다. URL: ${previewUrl}`);
            }}
            loading="lazy"
            crossOrigin="anonymous"
          />
        </div>
      );
    } catch (error) {
      console.error('Image preview error:', error);
      setError(error.message || '이미지 미리보기를 불러올 수 없습니다.');
      return (
        <div className="flex items-center justify-center h-full bg-gray-100">
          <Image className="w-8 h-8 text-gray-400" />
        </div>
      );
    }
  };

  const renderFilePreview = () => {
    const mimetype = msg.file?.mimetype || '';
    const originalname = getDecodedFilename(msg.file?.filename);
    const size = fileService.formatFileSize(msg.file?.size || 0);

    console.log("✅", mimetype, originalname, size);
    
    const FileActions = () => (
      <div className="file-actions mt-2 pt-2 border-t border-gray-200">
        <Button
          size="sm"
          variant="outline"
          onClick={handleViewInNewTab}
          title="새 탭에서 보기"
        >
          <OpenInNewOutlineIcon size={16} />
          <span>새 탭에서 보기</span>
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleFileDownload}
          title="다운로드"
        >
          <Download size={16} />
          <span>다운로드</span>
        </Button>
      </div>
    );

    const previewWrapperClass = "overflow-hidden";
    const fileInfoClass = "flex items-center gap-3 p-1 mt-2";

    if (mimetype.startsWith('image/')) {
      return (
        <div className={previewWrapperClass}>
          {renderImagePreview(originalname)}
          <div className={fileInfoClass}>
            <div className="flex-1 min-w-0">
              <Text typography="body2" className="font-medium truncate">{getFileIcon()} {originalname}</Text>
              <span className="text-sm text-muted">{size}</span>
            </div>
          </div>
          <FileActions />
        </div>
      );
    }

    if (mimetype.startsWith('video/')) {
      return (
        <div className={previewWrapperClass}>
          <div>
            {previewUrl ? (
              <video 
                className="object-cover rounded-sm"
                controls
                preload="metadata"
                aria-label={`${originalname} 비디오`}
                crossOrigin="anonymous"
              >
                <source src={previewUrl} type={mimetype} />
                <track kind="captions" />
                비디오를 재생할 수 없습니다.
              </video>
            ) : (
              <div className="flex items-center justify-center h-full">
                <Film className="w-8 h-8 text-gray-400" />
              </div>
            )}
          </div>
          <div className={fileInfoClass}>
            <div className="flex-1 min-w-0">
              <Text typography="body2" className="font-medium truncate">{getFileIcon()} {originalname}</Text>
              <span className="text-sm text-muted">{size}</span>
            </div>
          </div>
          <FileActions />
        </div>
      );
    }

    if (mimetype.startsWith('audio/')) {
      return (
        <div className={previewWrapperClass}>
          <div className={fileInfoClass}>
            <div className="flex-1 min-w-0">
              <Text typography="body2" className="font-medium truncate">{getFileIcon()} {originalname}</Text>
              <span className="text-sm text-muted">{size}</span>
            </div>
          </div>
          <div className="px-3 pb-3">
            {previewUrl && (
              <audio 
                className="w-full"
                controls
                preload="metadata"
                aria-label={`${originalname} 오디오`}
                crossOrigin="anonymous"
              >
                <source src={previewUrl} type={mimetype} />
                오디오를 재생할 수 없습니다.
              </audio>
            )}
          </div>
          <FileActions />
        </div>
      );
    }

    return (
      <div className={previewWrapperClass}>
        <div className={fileInfoClass}>
          <div className="flex-1 min-w-0">
            <div className="font-medium truncate">{getFileIcon()} {originalname}</div>
            <Text typography="body2" as="span">{size}</Text>
          </div>
        </div>
        <FileActions />
      </div>
    );
  };

  return (
    <div className="messages">
      <div className={`message-group ${isMine ? 'mine' : 'yours'}`}>
        <div className="message-sender-info">
          {renderAvatar()}
          <span className="sender-name">
            {isMine ? '나' : msg.sender?.name}
          </span>
        </div>
        <div className={`message-bubble ${isMine ? 'message-mine' : 'message-other'} last file-message`}>

          <div className="message-content">
            {error && (
              <Callout color="danger" className="mb-3 d-flex align-items-center">
                <AlertCircle className="w-4 h-4 me-2" />
                <span>{error}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ms-auto"
                  aria-label="Close"
                  onClick={() => setError(null)}
                >
                  x
                </Button>
              </Callout>
            )}
            {renderFilePreview()}
            {msg.content && (
              <div className="mt-3">
                <MessageContent content={msg.content} />
              </div>
            )}
          </div>
          
          <div className="message-footer">
            <div 
              className="message-time mr-3" 
              title={new Date(msg.timestamp).toLocaleString('ko-KR')}
            >
              {formattedTime}
            </div>
            <ReadStatus 
              messageType={msg.type}
              participants={room.participants}
              readers={msg.readers}
              messageId={msg._id}
              messageRef={messageRef}
              currentUserId={currentUser.id}
              socketRef={socketRef}
            />
          </div>
        </div>
        <MessageActions 
          messageId={msg._id}
          messageContent={msg.content}
          reactions={msg.reactions}
          currentUserId={currentUser?.id}
          onReactionAdd={onReactionAdd}
          onReactionRemove={onReactionRemove}
          onMessageDelete={onMessageDelete}
          isMine={isMine}
          room={room}
          messageRef={msg}
        />        
      </div>
    </div>
  );
};

FileMessage.defaultProps = {
  msg: {
    file: {
      mimetype: '',
      filename: '',
      originalname: '',
      size: 0
    }
  },
  isMine: false,
  currentUser: null,
  onMessageDelete: () => {}
};

export default React.memo(FileMessage);