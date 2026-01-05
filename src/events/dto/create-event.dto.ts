export class CreateEventDto {
  title: string;
  description?: string;
  startTime: string; // "2026-01-10T10:00:00Z"
  endTime: string;
  location: string;
  imageUrl?: string;
}