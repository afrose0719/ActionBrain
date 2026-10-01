export type Priority = "low" | "medium" | "high";
export type Status = "todo" | "done";

export type Task = {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  status: Status;
  priority: Priority;
  due_date: string | null;
  source_type: string | null;
  source_text: string | null;
  related_person: string | null;
  ai_generated: boolean;
  completed_at: string | null;
  created_at: string;
};

export type SuggestionState = "pending" | "created" | "dismissed";

export type Suggestion = {
  id: string;
  title: string;
  description?: string | null;
  priority: Priority;
  due_date: string | null;
  related_person?: string | null;
  confidence: number; // 0..1
  quote: string; // the part of the message this came from
  state: SuggestionState;
};

export type InboxStatus = "new" | "analyzed" | "archived";

export type InboxItem = {
  id: string;
  source_type: string;
  source_ref: string | null;
  content: string;
  status: InboxStatus;
  ai_suggestions: Suggestion[];
  created_at: string;
};

export type Direction = "mine" | "theirs";
export type CommitmentStatus = "suggested" | "open" | "done" | "dismissed";

export type Commitment = {
  id: string;
  direction: Direction;
  owner_name: string | null;
  counterparty: string | null;
  description: string;
  due_date: string | null;
  status: CommitmentStatus;
  source_type: string | null;
  source_id: string | null;
  source_text: string | null;
  confidence: number | null;
  ai_generated: boolean;
  task_id: string | null;
  completed_at: string | null;
  created_at: string;
};

export type MeetingStatus = "new" | "analyzed";

export type Meeting = {
  id: string;
  title: string;
  meeting_date: string;
  attendees: string | null;
  transcript: string;
  status: MeetingStatus;
  summary: string | null;
  decisions: string[];
  ai_suggestions: Suggestion[];
  created_at: string;
};
