export type PreviewMode =
  | "result"
  | "loading"
  | "error"
  | "offline"
  | "long";

export interface ContextSegment {
  text: string;
  highlight?: boolean;
}

export interface ResultContent {
  word: string;
  phonetic: string;
  partOfSpeech?: string;
  translation: string;
  context: ContextSegment[];
}

export type PopoverViewModel =
  | {
      state: "result";
      content: ResultContent;
      longContent?: boolean;
    }
  | {
      state: "loading";
      word: string;
    }
  | {
      state: "error";
      word: string;
      failureCode?: string;
    }
  | {
      state: "offline";
      word: string;
    };
