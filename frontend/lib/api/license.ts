import { api } from "@/lib/api/client";

export interface LicenseStatus {
  licensed: boolean;
  enforced: boolean;
  plan: string | null;
  email: string | null;
  issued_at: string | null;
  expires_at: string | null;
  activated_at: string | null;
  message: string | null;
}

export const licenseApi = {
  status: () => api.get<LicenseStatus>("/license"),
  activate: (licenseKey: string) =>
    api.post<LicenseStatus>("/license", { license_key: licenseKey }),
  remove: () => api.delete<unknown>("/license"),
};
