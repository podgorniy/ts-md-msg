import { MessageEntity } from './entity.js';
import { InputRichMessage } from './rich.js';

export enum ContentType {
  TEXT = 'text',
  FILE = 'file',
  PHOTO = 'photo',
  RICH = 'rich',
}

export interface ContentTrace {
  sourceType: string;
  extra?: Record<string, any>;
}

export interface Text {
  text: string;
  entities: MessageEntity[];
  contentTrace: ContentTrace;
  contentType: ContentType.TEXT;
}

export interface File {
  fileName: string;
  fileData: Uint8Array;
  contentTrace: ContentTrace;
  captionText: string;
  captionEntities: MessageEntity[];
  contentType: ContentType.FILE;
}

export interface Photo {
  fileName: string;
  fileData: Uint8Array;
  contentTrace: ContentTrace;
  captionText: string;
  captionEntities: MessageEntity[];
  contentType: ContentType.PHOTO;
}

export interface RichMessage {
  richMessage: InputRichMessage;
  contentTrace: ContentTrace;
  contentType: ContentType.RICH;
}

export type Content = Text | File | Photo | RichMessage;
