import { findZone, getZone } from "./cloudflare-api";
import { AppError } from "./errors";
import { parseCreateCertificate, type CreateCertificateInput } from "./validation";

function belongsToZone(domain: string, zoneName: string): boolean {
  const hostname = domain.replace(/^\*\./, "");
  return hostname === zoneName || hostname.endsWith(`.${zoneName}`);
}

export async function resolveCertificateInput(value: unknown, apiToken: string): Promise<CreateCertificateInput> {
  const input = parseCreateCertificate(value);
  if (input.zoneId) {
    const zone = await getZone(apiToken, input.zoneId);
    if (input.domains.length === 0) {
      // Match the Origin CA dashboard defaults; persist the resolved names for renewals.
      return parseCreateCertificate({ ...input, domains: [zone.name, `*.${zone.name}`] });
    }
    if (input.domains.some((domain) => !belongsToZone(domain, zone.name))) {
      throw new AppError(400, "DOMAIN_OUTSIDE_ZONE", `All hostnames must belong to the selected Cloudflare site (${zone.name})`);
    }
  } else {
    // Existing API clients may supply hostnames without a site selector. Verify
    // every name against zones accessible to the configured token before storing it.
    const verifiedZones: string[] = [];
    for (const domain of input.domains) {
      if (verifiedZones.some((zone) => belongsToZone(domain, zone))) continue;
      const zone = await findZone(apiToken, domain);
      verifiedZones.push(zone.name);
    }
  }
  return input;
}
