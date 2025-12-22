/**
 * Email Utility
 * Handles sending emails using nodemailer
 */

import nodemailer from 'nodemailer';

// Email configuration from environment variables
const emailConfig = {
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
  },
};

// Create reusable transporter
const createTransporter = () => {
  if (!emailConfig.auth.user || !emailConfig.auth.pass) {
    console.warn('❌ Email credentials not configured. Email sending will be disabled.');
    console.warn('Missing:', {
      user: !emailConfig.auth.user,
      pass: !emailConfig.auth.pass,
    });
    return null;
  }

  console.log('✅ Email transporter created with config:', {
    host: emailConfig.host,
    port: emailConfig.port,
    secure: emailConfig.secure,
    user: emailConfig.auth.user,
    passwordLength: emailConfig.auth.pass?.length || 0,
  });

  return nodemailer.createTransport({
    host: emailConfig.host,
    port: emailConfig.port,
    secure: emailConfig.secure,
    auth: emailConfig.auth,
    // Add connection timeout
    connectionTimeout: 10000, // 10 seconds
    greetingTimeout: 10000,
    socketTimeout: 10000,
  });
};

/**
 * Send password reset email
 */
export async function sendPasswordResetEmail(
  email: string,
  name: string,
  resetUrl: string
): Promise<void> {
  const transporter = createTransporter();
  
  if (!transporter) {
    console.warn('Email transporter not available. Logging reset URL instead.');
    console.log('Password reset URL for', email, ':', resetUrl);
    return;
  }

  const mailOptions = {
    from: `"ForexOrbit Academy" <${emailConfig.auth.user}>`,
    to: email,
    subject: 'Password Reset Request - ForexOrbit Academy',
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Password Reset</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #00273F 0%, #003153 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: #ffffff; margin: 0;">ForexOrbit Academy</h1>
          </div>
          
          <div style="background: #ffffff; padding: 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 10px 10px;">
            <h2 style="color: #00273F; margin-top: 0;">Password Reset Request</h2>
            
            <p>Hello ${name || 'there'},</p>
            
            <p>We received a request to reset your password for your ForexOrbit Academy account.</p>
            
            <p>Click the button below to reset your password:</p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${resetUrl}" 
                 style="display: inline-block; background: #00273F; color: #ffffff; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                Reset Password
              </a>
            </div>
            
            <p>Or copy and paste this link into your browser:</p>
            <p style="word-break: break-all; color: #0066cc;">${resetUrl}</p>
            
            <p><strong>This link will expire in 1 hour.</strong></p>
            
            <p>If you didn't request a password reset, please ignore this email. Your password will remain unchanged.</p>
            
            <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 30px 0;">
            
            <p style="color: #666; font-size: 12px; margin: 0;">
              This is an automated message from ForexOrbit Academy. Please do not reply to this email.
            </p>
          </div>
        </body>
      </html>
    `,
    text: `
      Password Reset Request - ForexOrbit Academy
      
      Hello ${name || 'there'},
      
      We received a request to reset your password for your ForexOrbit Academy account.
      
      Click the link below to reset your password:
      ${resetUrl}
      
      This link will expire in 1 hour.
      
      If you didn't request a password reset, please ignore this email. Your password will remain unchanged.
      
      ---
      This is an automated message from ForexOrbit Academy. Please do not reply to this email.
    `,
  };

  try {
    console.log('Sending email via SMTP:', {
      from: mailOptions.from,
      to: mailOptions.to,
      host: emailConfig.host,
      port: emailConfig.port,
      secure: emailConfig.secure,
    });
    
    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Password reset email sent successfully:', {
      messageId: info.messageId,
      response: info.response,
      accepted: info.accepted,
      rejected: info.rejected,
    });
  } catch (error: any) {
    console.error('❌ Error sending password reset email:', error);
    console.error('Error details:', {
      message: error?.message,
      code: error?.code,
      command: error?.command,
      response: error?.response,
      responseCode: error?.responseCode,
      errno: error?.errno,
      syscall: error?.syscall,
      hostname: error?.hostname,
      port: error?.port,
    });
    // Log the URL as fallback
    console.log('Password reset URL for', email, ':', resetUrl);
    throw error;
  }
}

/**
 * Check if email is configured
 */
export function isEmailConfigured(): boolean {
  return !!(emailConfig.auth.user && emailConfig.auth.pass);
}

