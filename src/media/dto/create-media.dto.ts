export class CreateMediaDto {
    title: string;
    type: string;    // "SERMON" or "LIVESTREAM"
    url: string;     // YouTube link
    speaker: string;
  }