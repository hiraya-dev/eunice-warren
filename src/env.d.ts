declare module "cloudflare:workers" {
  export const env: Record<string, unknown>;
}

declare namespace App {
  interface Locals {
    adminHost?: { email: string; firstName: string; sample: boolean };
  }
}
