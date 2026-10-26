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
 * Check if Cloudinary is configured
 */
export function isCloudinaryConfigured(): boolean {
  const hasCloudName = !!process.env.CLOUDINARY_CLOUD_NAME;
  const hasApiKey = !!process.env.CLOUDINARY_API_KEY;
  const hasApiSecret = !!process.env.CLOUDINARY_API_SECRET;
  
  if (!hasCloudName || !hasApiKey || !hasApiSecret) {
    console.error('Cloudinary configuration check:', {
      hasCloudName,
      hasApiKey,
      hasApiSecret,
      cloudNameLength: process.env.CLOUDINARY_CLOUD_NAME?.length || 0,
      apiKeyLength: process.env.CLOUDINARY_API_KEY?.length || 0,
      apiSecretLength: process.env.CLOUDINARY_API_SECRET?.length || 0,
    });
  }
  
  return hasCloudName && hasApiKey && hasApiSecret;
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
    transformation?: Record<string, unknown>;
  } = {}
): Promise<UploadResult> {
  if (!isCloudinaryConfigured()) {
    const missing = [];
    if (!process.env.CLOUDINARY_CLOUD_NAME) missing.push('CLOUDINARY_CLOUD_NAME');
    if (!process.env.CLOUDINARY_API_KEY) missing.push('CLOUDINARY_API_KEY');
    if (!process.env.CLOUDINARY_API_SECRET) missing.push('CLOUDINARY_API_SECRET');
    console.error('Cloudinary configuration missing:', missing.join(', '));
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
 * Upload image from file path to Cloudinary (more efficient for large files)
 */
export async function uploadImageFromPath(
  filePath: string,
  folder: string,
  options: {
    userId?: string;
    resourceType?: 'image' | 'auto';
    transformation?: Record<string, unknown>;
  } = {}
): Promise<UploadResult> {
  if (!isCloudinaryConfigured()) {
    const missing = [];
    if (!process.env.CLOUDINARY_CLOUD_NAME) missing.push('CLOUDINARY_CLOUD_NAME');
    if (!process.env.CLOUDINARY_API_KEY) missing.push('CLOUDINARY_API_KEY');
    if (!process.env.CLOUDINARY_API_SECRET) missing.push('CLOUDINARY_API_SECRET');
    console.error('Cloudinary configuration missing:', missing.join(', '));
    throw new Error('Cloudinary configuration is missing. Please set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET environment variables.');
  }

  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload(
      filePath,
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
  });
}

/**
 * Delete image from Cloudinary by public ID
 */
export async function deleteImage(publicId: string): Promise<void> {
  if (!isCloudinaryConfigured()) {
    throw new Error('Cloudinary configuration is missing');
  }

  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Cloudinary delete error:', error);
    throw new Error(`Failed to delete image: ${errorMessage}`);
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

