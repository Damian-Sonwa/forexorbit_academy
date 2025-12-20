/**
 * Cloudinary Upload Utility
 * Centralized image upload service using Cloudinary
 */

import { v2 as cloudinary } from 'cloudinary';
import { Readable } from 'stream';

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export interface UploadResult {
  url: string;
  publicId: string;
  secureUrl: string;
  width?: number;
  height?: number;
  format?: string;
  bytes?: number;
}

/**
 * Upload image buffer to Cloudinary
 */
export async function uploadImage(
  buffer: Buffer,
  folder: string,
  options: {
    userId?: string;
    resourceType?: 'image' | 'auto';
    transformation?: any;
  } = {}
): Promise<UploadResult> {
  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    throw new Error('Cloudinary configuration is missing. Please set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET environment variables.');
  }

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: `forexorbit/${folder}`,
        resource_type: options.resourceType || 'image',
        transformation: options.transformation,
        public_id: options.userId ? `${options.userId}_${Date.now()}` : undefined,
        overwrite: false,
        unique_filename: true,
        use_filename: true,
      },
      (error, result) => {
        if (error) {
          console.error('Cloudinary upload error:', error);
          reject(new Error(`Failed to upload image: ${error.message}`));
        } else if (!result) {
          reject(new Error('Cloudinary upload returned no result'));
        } else {
          resolve({
            url: result.secure_url || result.url,
            publicId: result.public_id,
            secureUrl: result.secure_url || result.url,
            width: result.width,
            height: result.height,
            format: result.format,
            bytes: result.bytes,
          });
        }
      }
    );

    // Convert buffer to stream
    const readable = new Readable();
    readable.push(buffer);
    readable.push(null);
    readable.pipe(uploadStream);
  });
}

/**
 * Delete image from Cloudinary by public ID
 */
export async function deleteImage(publicId: string): Promise<void> {
  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    throw new Error('Cloudinary configuration is missing');
  }

  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (error: any) {
    console.error('Cloudinary delete error:', error);
    throw new Error(`Failed to delete image: ${error.message}`);
  }
}

/**
 * Validate image file
 */
export function validateImageFile(file: {
  mimetype?: string;
  size?: number;
  originalFilename?: string;
}): { valid: boolean; error?: string } {
  // Check file type
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
  if (!file.mimetype || !allowedTypes.includes(file.mimetype.toLowerCase())) {
    return {
      valid: false,
      error: 'Invalid file type. Only JPG, JPEG, PNG, GIF, and WEBP images are allowed.',
    };
  }

  // Check file size (10MB max)
  const maxSize = 10 * 1024 * 1024; // 10MB
  if (file.size && file.size > maxSize) {
    return {
      valid: false,
      error: `File size exceeds 10MB limit. Current size: ${(file.size / 1024 / 1024).toFixed(2)}MB`,
    };
  }

  return { valid: true };
}

