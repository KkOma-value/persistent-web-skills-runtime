export interface DemoTask {
  id: string;
  title: string;
  description: string;
  priority: "low" | "medium" | "high";
  assignee: string;
  project: string;
  status: "todo" | "in-progress" | "blocked";
  label: string;
  estimate: string;
  dueDate: string;
  createdAt: number;
}
