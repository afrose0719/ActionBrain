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
