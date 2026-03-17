import type { StreamAttachment } from '../api';
import { ExternalLinkIcon, FileIcon, YouTubeIcon } from './icons';

export default function AttachmentLink({ att }: { att: StreamAttachment }) {
  const url = att.url;
  const label = att.label || url;
  const isYoutube = url.includes('youtube.com/watch') || url.includes('youtu.be/');
  const isPdf = url.toLowerCase().endsWith('.pdf');

  return (
    <a className="stream-attachment-link" href={url} target="_blank" rel="noopener noreferrer">
      {isYoutube && <YouTubeIcon size={16} />}
      {isPdf && !isYoutube && <FileIcon size={16} />}
      {!isYoutube && !isPdf && <ExternalLinkIcon size={16} />}
      <span>{label}</span>
    </a>
  );
}
