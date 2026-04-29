import { NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

const UPLOAD_DIR = join(process.cwd(), 'public', 'uploads');

// Ensure uploads directory exists
async function ensureUploadDir() {
  try {
    await mkdir(UPLOAD_DIR, { recursive: true });
  } catch (err) {
    // Directory might already exist
  }
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .substring(0, 100);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ channelId: string }> }
) {
  try {
    const { channelId } = await context.params;
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    // Validate file type
    const mimeType = file.type;
    const isAudio = mimeType.startsWith('audio/');
    const isVideo = mimeType.startsWith('video/');

    if (!isAudio && !isVideo) {
      return NextResponse.json(
        { error: 'File must be audio or video' },
        { status: 400 }
      );
    }

    // Validate file size (100MB limit)
    const maxSize = 100 * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: 'File exceeds 100MB limit' },
        { status: 413 }
      );
    }

    await ensureUploadDir();

    // Create unique filename
    const timestamp = Date.now();
    const sanitized = sanitizeFilename(file.name);
    const filename = `${timestamp}_${sanitized}`;
    const filepath = join(UPLOAD_DIR, filename);

    // Write file
    const buffer = await file.arrayBuffer();
    await writeFile(filepath, Buffer.from(buffer));

    // Return URL
    const fileUrl = `/uploads/${filename}`;

    return NextResponse.json({
      success: true,
      url: fileUrl,
      filename: file.name,
      size: file.size,
      type: mimeType
    });
  } catch (error) {
    logger.error('Upload failed', { error });
    return NextResponse.json(
      { error: 'Upload failed' },
      { status: 500 }
    );
  }
}
