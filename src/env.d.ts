declare module "cloudflare:workers" {
  export interface SendEmailAddress {
    email: string;
    name?: string;
  }

  export interface SendEmailMessage {
    from: string | SendEmailAddress;
    to: Array<string | SendEmailAddress>;
    replyTo?: string | SendEmailAddress;
    subject: string;
    text: string;
    html: string;
  }

  export interface SendEmailBinding {
    send(message: SendEmailMessage): Promise<void>;
  }

  export interface WorkerEnv {
    NOTIFY_TO?: string;
    RSVP_EMAIL?: SendEmailBinding;
    [key: string]: unknown;
  }

  export const env: WorkerEnv;
}

declare namespace App {
  interface Locals {
    adminHost?: { email: string; firstName: string; sample: boolean };
  }
}
