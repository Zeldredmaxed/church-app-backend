import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import OpenAI from 'openai';

@Injectable()
export class AiService {
  private openai: OpenAI;

  constructor(private readonly prisma: PrismaService) {
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  async askPastor(question: string) {
    // 1. Fetch recent sermon summaries (Context)
    const mediaItems = await this.prisma.media.findMany({
      where: { summary: { not: null } },
      take: 5, // Give AI the last 5 sermons as context
      orderBy: { publishedAt: 'desc' },
      select: { title: true, summary: true, url: true } // Get the URL so AI can link to it!
    });

    // 2. Build the "System Prompt"
    // This tells ChatGPT who it is.
    const contextString = mediaItems.map(m => `Sermon Title: "${m.title}". Summary: "${m.summary}". Link: ${m.url}`).join('\n\n');

    const systemPrompt = `
      You are a helpful Ministry Assistant for New Birth Praise and Worship Center.
      Answer the user's question based ONLY on the following sermon context.
      If the answer is found in a sermon, mention the sermon title and provide the link.
      If the answer is not in the sermons, provide a biblically accurate answer but mention "I couldn't find this specific topic in recent sermons."
      
      CONTEXT:
      ${contextString}
    `;

    // 3. Call OpenAI
    const completion = await this.openai.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: question }
      ],
      model: "gpt-3.5-turbo", // or "gpt-4" if you want to pay more for smarter answers
    });

    return { answer: completion.choices[0].message.content };
  }
}
