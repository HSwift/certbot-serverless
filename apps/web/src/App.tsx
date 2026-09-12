import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  CalendarClock,
  Check,
  CircleAlert,
  Download,
  Ellipsis,
  FileKey2,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Plus,
  RefreshCw,
  Search,
  ServerCog,
  X,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DownloadCertificateDialog, type DownloadDialogState } from "@/components/download-certificate-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { renderSystemdUnits, suggestedUnitName, type RenderedSystemdUnits, type SyncInterval } from "@/lib/systemd";
import { cn } from "@/lib/utils";
import type { Authority, Certificate, CloudflareZone, CreateCertificatePayload, Deployment, Job, Overview } from "@/lib/types";

const emptyOverview: Overview = {
  summary: { total: 0, active: 0, failed: 0, autoRenew: 0, expiring: 0 },
  recentJobs: [],
};

const statusLabel: Record<Certificate["status"], string> = {
  active: "Active",
  pending: "Pending",
  issuing: "Issuing",
  failed: "Failed",
  revoked: "Revoked",
};

function formatDate(value: string | null, withTime = false): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
  }).format(new Date(value));
}

function relativeExpiry(value: string | null): string {
  if (!value) return "Not issued";
  const days = Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return `Expired ${Math.abs(days)}d ago`;
  if (days === 0) return "Expires today";
  return `Expires in ${days}d`;
}

function StatusBadge({ status }: { status: Certificate["status"] }) {
  const processing = status === "pending" || status === "issuing";
  return (
    <Badge className={cn(
      status === "active" && "text-ember-orange",
      status === "failed" && "bg-ink text-white ring-ink",
    )}>
      <span className={cn("size-1.5 rounded-full bg-current", processing && "pulse-dot")} />
      {statusLabel[status]}
    </Badge>
  );
}

function downloadTextFile(fileName: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

interface CreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => Promise<void>;
  notify: (message: string, kind?: "success" | "error") => void;
}

function CreateCertificateDialog({ open, onOpenChange, onCreated, notify }: CreateDialogProps) {
  const [authority, setAuthority] = useState<Authority>("letsencrypt");
  const [name, setName] = useState("");
  const [domains, setDomains] = useState("");
  const [originDomains, setOriginDomains] = useState("");
  const [zones, setZones] = useState<CloudflareZone[]>([]);
  const [zoneId, setZoneId] = useState("");
  const [loadingZones, setLoadingZones] = useState(false);
  const [zoneError, setZoneError] = useState("");
  const [zoneReload, setZoneReload] = useState(0);
  const [email, setEmail] = useState("");
  const [keyType, setKeyType] = useState<CreateCertificatePayload["keyType"]>("ec-p256");
  const [autoRenew, setAutoRenew] = useState(true);
  const [validity, setValidity] = useState("5475");
  const [submitting, setSubmitting] = useState(false);
  const isOrigin = authority === "cloudflare-origin";
  const selectedZone = zones.find((zone) => zone.id === zoneId);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoadingZones(true);
    setZoneError("");
    void api.cloudflareZones()
      .then(({ zones: availableZones }) => {
        if (!active) return;
        setZones(availableZones);
        setZoneId((current) => availableZones.some((zone) => zone.id === current)
          ? current
          : availableZones.length === 1 ? availableZones[0].id : "");
      })
      .catch((error) => {
        if (!active) return;
        setZones([]);
        setZoneId("");
        setZoneError(error instanceof Error ? error.message : "Unable to load Cloudflare sites");
      })
      .finally(() => { if (active) setLoadingZones(false); });
    return () => { active = false; };
  }, [open, zoneReload]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const domainList = (isOrigin ? originDomains : domains).split(/[\n,\s]+/).map((domain) => domain.trim()).filter(Boolean);
    if (!name.trim()) {
      notify("Certificate name is required", "error");
      return;
    }
    if (!selectedZone) {
      notify("Select a Cloudflare site", "error");
      return;
    }
    if (!isOrigin && (domainList.length === 0 || !email.trim())) {
      notify("Domains and contact email are required for Let's Encrypt", "error");
      return;
    }
    setSubmitting(true);
    try {
      await api.createCertificate({
        name: name.trim(),
        authority,
        zoneId: selectedZone.id,
        ...(!isOrigin || domainList.length > 0 ? { domains: domainList } : {}),
        keyType,
        autoRenew,
        ...(authority === "letsencrypt" ? { acmeEmail: email.trim() } : { originValidityDays: Number(validity) }),
      });
      notify("Issuance job created");
      onOpenChange(false);
      setName("");
      setDomains("");
      setOriginDomains("");
      await onCreated();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to create certificate", "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <p className="font-mono text-[12px] uppercase tracking-[0.02em] text-slate">Certificate / New</p>
          <DialogTitle>Create certificate</DialogTitle>
          <DialogDescription>{isOrigin
            ? "Create an Origin CA certificate for TLS between Cloudflare and your origin server. Select a site to use its default hostname coverage."
            : "Create a publicly trusted certificate. Domain ownership is verified automatically through DNS-01."}</DialogDescription>
        </DialogHeader>

        <form className="grid gap-5" onSubmit={submit}>
          <div className="grid gap-2">
            <Label>Certificate authority</Label>
            <div className="grid grid-cols-1 gap-2 rounded-[4px] bg-vellum p-1 ring-1 ring-inset ring-gridline sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setAuthority("letsencrypt")}
                className={cn(
                  "rounded-[3px] px-3 py-2.5 text-left transition-colors",
                  authority === "letsencrypt" ? "bg-white text-ink ring-1 ring-gridline" : "text-slate hover:text-ink",
                )}
              >
                <span className="block text-sm font-medium">Let's Encrypt</span>
                <span className="mt-1 block font-mono text-[11px] uppercase tracking-[0.02em] text-slate">Public trust · 90d</span>
              </button>
              <button
                type="button"
                onClick={() => setAuthority("cloudflare-origin")}
                className={cn(
                  "rounded-[3px] px-3 py-2.5 text-left transition-colors",
                  authority === "cloudflare-origin" ? "bg-white text-ink ring-1 ring-gridline" : "text-slate hover:text-ink",
                )}
              >
                <span className="block text-sm font-medium">Cloudflare Origin</span>
                <span className="mt-1 block font-mono text-[11px] uppercase tracking-[0.02em] text-slate">Proxy only · Private CA</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="certificate-name">Display name</Label>
              <Input id="certificate-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="production-origin" autoFocus />
            </div>
            <div className="grid gap-2">
              <Label>Key algorithm</Label>
              <Select value={keyType} onValueChange={(value) => setKeyType(value as CreateCertificatePayload["keyType"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ec-p256">ECDSA P-256 (recommended)</SelectItem>
                  <SelectItem value="rsa-2048">RSA 2048</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="cloudflare-site">Cloudflare site</Label>
            <Select value={zoneId} onValueChange={(value) => { if (value) setZoneId(value); }} disabled={loadingZones || zones.length === 0}>
              <SelectTrigger id="cloudflare-site"><SelectValue placeholder={loadingZones ? "Loading sites…" : "Select a site"} /></SelectTrigger>
              <SelectContent>
                {zones.map((zone) => <SelectItem key={zone.id} value={zone.id}>{zone.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {zoneError ? (
              <div className="flex items-center gap-2 text-xs text-slate" role="alert">
                <span>{zoneError}</span>
                <Button type="button" variant="outline" size="sm" onClick={() => setZoneReload((value) => value + 1)}>Retry</Button>
              </div>
            ) : !loadingZones && zones.length === 0 ? (
              <p className="text-xs text-slate">No active Cloudflare sites are available for this account.</p>
            ) : null}
            {isOrigin && selectedZone && (
              <p className="text-xs leading-5 text-slate">Default coverage: <span className="font-mono">{selectedZone.name}</span> and <span className="font-mono">*.{selectedZone.name}</span>. No hostname entry is needed.</p>
            )}
          </div>

          {isOrigin ? (
            <div className="grid gap-3">
              <details className="grid gap-2">
                <summary className="cursor-pointer text-sm text-ink">Custom hostnames (optional)</summary>
                <div className="mt-2 grid gap-2">
                  <Label htmlFor="origin-domains">Hostnames / SANs</Label>
                  <textarea
                    id="origin-domains"
                    value={originDomains}
                    onChange={(event) => setOriginDomains(event.target.value)}
                    rows={3}
                    placeholder={selectedZone ? `${selectedZone.name}\n*.${selectedZone.name}` : "example.com\n*.example.com"}
                    className="w-full resize-y rounded-[4px] bg-white px-3 py-2.5 font-mono text-[14px] leading-6 text-ink ring-1 ring-inset ring-gridline placeholder:text-stone focus:outline-none focus:ring-2 focus:ring-ember-orange/20"
                  />
                  <p className="text-xs leading-5 text-slate">Leave blank to use the selected site's default coverage. Custom hostnames replace the defaults and must belong to the selected site; enter up to 200 names, one per line. No DNS-01 challenge or contact email is needed.</p>
                </div>
              </details>
            </div>
          ) : (
            <div className="grid gap-2">
              <Label htmlFor="domains">Domains / SANs</Label>
              <textarea
                id="domains"
                value={domains}
                onChange={(event) => setDomains(event.target.value)}
                rows={4}
                placeholder={selectedZone ? `${selectedZone.name}\n*.${selectedZone.name}` : "example.com\n*.example.com"}
                className="w-full resize-y rounded-[4px] bg-white px-3 py-2.5 font-mono text-[14px] leading-6 text-ink ring-1 ring-inset ring-gridline placeholder:text-stone focus:outline-none focus:ring-2 focus:ring-ember-orange/20"
              />
              <p className="text-xs text-slate">Enter one domain per line within the selected Cloudflare site. Wildcard certificates are verified automatically through Cloudflare DNS-01.</p>
            </div>
          )}

          {authority === "letsencrypt" ? (
            <div className="grid gap-2">
              <Label htmlFor="acme-email">ACME contact email</Label>
              <Input id="acme-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="ops@example.com" />
            </div>
          ) : (
            <div className="grid gap-2">
              <Label>Validity</Label>
              <Select value={validity} onValueChange={setValidity}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">7 days</SelectItem>
                  <SelectItem value="30">30 days</SelectItem>
                  <SelectItem value="90">90 days</SelectItem>
                  <SelectItem value="365">1 year</SelectItem>
                  <SelectItem value="730">2 years</SelectItem>
                  <SelectItem value="1095">3 years</SelectItem>
                  <SelectItem value="5475">15 years (recommended)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs leading-5 text-slate">Install the certificate and private key on your origin, enable Cloudflare proxying, and use Full (strict) SSL/TLS mode. Origin CA certificates are not trusted directly by browsers.</p>
            </div>
          )}

          <div className="flex items-center justify-between rounded-[4px] bg-vellum px-3 py-3 ring-1 ring-inset ring-gridline">
            <div>
              <p className="text-sm font-medium text-ink">Automatic renewal</p>
              <p className="mt-0.5 text-xs text-slate">A daily Cron scan starts the renewal Workflow</p>
            </div>
            <Switch checked={autoRenew} onCheckedChange={setAutoRenew} aria-label="Automatic renewal" />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={submitting || loadingZones || !selectedZone}>
              {submitting ? <LoaderCircle className="animate-spin" /> : <Zap />}
              Create issuance job
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface DeploymentDialogProps {
  certificate: Certificate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notify: (message: string, kind?: "success" | "error") => void;
}

function DeploymentDialog({ certificate, open, onOpenChange, notify }: DeploymentDialogProps) {
  const [unitName, setUnitName] = useState("");
  const [destination, setDestination] = useState("");
  const [interval, setInterval] = useState<SyncInterval>("6h");
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [rendered, setRendered] = useState<RenderedSystemdUnits | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !certificate) return;
    let active = true;
    const suggested = suggestedUnitName(certificate.name);
    setUnitName(suggested);
    setDestination(`/etc/certbot-serverless/${suggested}`);
    setInterval("6h");
    setDeployments([]);
    setRendered(null);
    setLoading(true);
    void api.deployments(certificate.id)
      .then((result) => {
        if (active) setDeployments(result.deployments);
      })
      .catch((error) => {
        if (active) notify(error instanceof Error ? error.message : "Unable to load deployment URLs", "error");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [certificate, notify, open]);

  async function generate(event: FormEvent) {
    event.preventDefault();
    if (!certificate) return;
    setSubmitting(true);
    try {
      renderSystemdUnits({
        certificateName: certificate.name,
        deploymentUrl: "https://placeholder.invalid/deploy/token",
        destinationDirectory: destination,
        interval,
        unitName: unitName.trim(),
      });
      const created = await api.createDeployment(certificate.id, unitName.trim());
      const units = renderSystemdUnits({
        certificateName: certificate.name,
        deploymentUrl: created.url,
        destinationDirectory: destination,
        interval,
        unitName: unitName.trim(),
      });
      setRendered(units);
      setDeployments((current) => [created.deployment, ...current]);
      notify("Deployment URL and systemd units created");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to create systemd units", "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function revoke(deployment: Deployment) {
    if (!window.confirm(`Revoke deployment URL “${deployment.name}”?`)) return;
    setRevokingId(deployment.id);
    try {
      await api.revokeDeployment(deployment.id);
      setDeployments((current) => current.filter((item) => item.id !== deployment.id));
      notify("Deployment URL revoked");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to revoke deployment URL", "error");
    } finally {
      setRevokingId(null);
    }
  }

  const installCommands = rendered
    ? [
        `sudo install -m 0600 ${rendered.serviceFileName} /etc/systemd/system/${rendered.serviceFileName}`,
        `sudo install -m 0644 ${rendered.timerFileName} /etc/systemd/system/${rendered.timerFileName}`,
        "sudo systemctl daemon-reload",
        `sudo systemctl enable --now ${rendered.timerFileName}`,
        `sudo systemctl start ${rendered.serviceFileName}`,
      ].join("\n")
    : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <p className="font-mono text-[12px] uppercase tracking-[0.02em] text-slate">Certificate / File sync</p>
          <DialogTitle>Generate systemd units</DialogTitle>
          <DialogDescription>
            Create a revocable URL that always downloads the latest version of {certificate?.name ?? "this certificate"}. The generated units only synchronize files and do not reload an application.
          </DialogDescription>
        </DialogHeader>

        {!rendered ? (
          <form className="grid gap-5" onSubmit={generate}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="deployment-unit-name">Unit identifier</Label>
                <Input
                  id="deployment-unit-name"
                  value={unitName}
                  onChange={(event) => setUnitName(event.target.value.toLowerCase())}
                  placeholder="production-origin"
                  pattern="[a-z0-9][a-z0-9_.-]{0,63}"
                  required
                />
                <p className="text-xs text-slate">Used in the generated service and timer filenames.</p>
              </div>
              <div className="grid gap-2">
                <Label>Synchronization interval</Label>
                <Select value={interval} onValueChange={(value) => setInterval(value as SyncInterval)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="15m">Every 15 minutes</SelectItem>
                    <SelectItem value="1h">Every hour</SelectItem>
                    <SelectItem value="6h">Every 6 hours</SelectItem>
                    <SelectItem value="12h">Every 12 hours</SelectItem>
                    <SelectItem value="1d">Every day</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="deployment-destination">Destination directory</Label>
              <Input
                id="deployment-destination"
                className="font-mono text-[14px]"
                value={destination}
                onChange={(event) => setDestination(event.target.value)}
                placeholder="/etc/certbot-serverless/production-origin"
                required
              />
              <p className="text-xs text-slate">The service writes all PEM files, the CSR, and metadata into this directory.</p>
            </div>

            <div className="rounded-[4px] bg-vellum px-4 py-3 text-xs leading-5 text-slate ring-1 ring-inset ring-gridline">
              The Deployment URL is embedded in the service file and grants read-only access to this certificate's latest private-key bundle. Store the service file with mode <span className="font-mono text-ink">0600</span>.
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={submitting || certificate?.status !== "active"}>
                {submitting ? <LoaderCircle className="animate-spin" /> : <ServerCog />}
                Generate units
              </Button>
            </div>
          </form>
        ) : (
          <div className="grid gap-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[4px] bg-vellum p-4 ring-1 ring-gridline">
                <p className="break-all font-mono text-xs text-ink">{rendered.serviceFileName}</p>
                <p className="mt-2 text-xs leading-5 text-slate">Contains the scoped Deployment URL. Install with mode 0600.</p>
                <Button className="mt-4 w-full" size="sm" onClick={() => downloadTextFile(rendered.serviceFileName, rendered.service)}>
                  <Download /> Download service
                </Button>
              </div>
              <div className="rounded-[4px] bg-vellum p-4 ring-1 ring-gridline">
                <p className="break-all font-mono text-xs text-ink">{rendered.timerFileName}</p>
                <p className="mt-2 text-xs leading-5 text-slate">Starts the synchronization service every {interval}.</p>
                <Button className="mt-4 w-full" variant="outline" size="sm" onClick={() => downloadTextFile(rendered.timerFileName, rendered.timer)}>
                  <Download /> Download timer
                </Button>
              </div>
            </div>

            <div className="grid gap-2">
              <Label>Install and enable</Label>
              <pre className="max-h-44 overflow-auto rounded-[4px] bg-ink p-4 font-mono text-[12px] leading-5 text-white">{installCommands}</pre>
            </div>

            <div className="flex flex-col-reverse justify-between gap-2 sm:flex-row">
              <Button variant="outline" onClick={() => setRendered(null)}>Create another</Button>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </div>
          </div>
        )}

        <div className="border-t border-gridline pt-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-ink">Active deployment URLs</p>
              <p className="mt-1 text-xs text-slate">Revoke a URL to stop future synchronization.</p>
            </div>
            <Badge>{deployments.length}</Badge>
          </div>
          <div className="mt-3 divide-y divide-gridline border-y border-gridline">
            {loading ? (
              <div className="flex items-center gap-2 py-4 text-xs text-slate"><LoaderCircle className="size-4 animate-spin text-ember-orange" /> Loading deployments</div>
            ) : deployments.length === 0 ? (
              <p className="py-4 text-xs text-slate">No active deployment URLs.</p>
            ) : deployments.map((deployment) => (
              <div key={deployment.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{deployment.name}</p>
                  <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.02em] text-ash">
                    {deployment.lastUsedAt ? `Last sync ${formatDate(deployment.lastUsedAt, true)}` : "Never synchronized"}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={revokingId === deployment.id}
                  onClick={() => void revoke(deployment)}
                >
                  {revokingId === deployment.id ? <LoaderCircle className="animate-spin" /> : <X />}
                  Revoke
                </Button>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface CertificateActionsProps {
  certificate: Certificate;
  busy: boolean;
  onRenew: () => void;
  onDownload: () => void;
  onDeploy: () => void;
  onAutoRenew: (enabled: boolean) => void;
}

function CertificateActions({ certificate, busy, onRenew, onDownload, onDeploy, onAutoRenew }: CertificateActionsProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Manage ${certificate.name}`} disabled={busy}>
          {busy ? <LoaderCircle className="animate-spin" /> : <Ellipsis />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={onDownload} disabled={certificate.status !== "active"}>
          <Download /> Download PEM bundle
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onDeploy} disabled={certificate.status !== "active"}>
          <ServerCog /> Generate sync units
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onRenew} disabled={certificate.status === "issuing" || certificate.status === "pending"}>
          <RefreshCw /> Renew now
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAutoRenew(!certificate.autoRenew)}>
          <CalendarClock /> {certificate.autoRenew ? "Disable automatic renewal" : "Enable automatic renewal"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function JobLine({ job }: { job: Job }) {
  const success = job.status === "succeeded";
  const failed = job.status === "failed";
  return (
    <div className="grid grid-cols-[28px_1fr_auto] items-start gap-2 border-b border-gridline py-3.5 last:border-0">
      <span className={cn(
        "mt-0.5 flex size-6 items-center justify-center rounded-[3px] bg-vellum font-mono text-[11px] text-slate ring-1 ring-gridline",
        success && "text-ember-orange",
        failed && "bg-ink text-white ring-ink",
      )}>
        {success ? "✓" : failed ? "×" : "↻"}
      </span>
      <div className="min-w-0">
        <p className="truncate font-mono text-xs text-ink">
          {job.kind === "issue" ? "ISSUE" : "RENEW"} / {job.certificate_name ?? job.certificate_id.slice(0, 8)}
        </p>
        <p className="mt-1 truncate text-xs text-slate">{job.error ?? `job:${job.id.slice(0, 8)}`}</p>
      </div>
      <span className="font-mono text-[11px] uppercase tracking-[0.02em] text-ash">{job.status}</span>
    </div>
  );
}

export function App() {
  const [overview, setOverview] = useState<Overview>(emptyOverview);
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [deploymentCertificate, setDeploymentCertificate] = useState<Certificate | null>(null);
  const [downloadState, setDownloadState] = useState<DownloadDialogState | null>(null);
  const downloadRequest = useRef(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ message: string; kind: "success" | "error" } | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);

  const notify = useCallback((message: string, kind: "success" | "error" = "success") => {
    setNotice({ message, kind });
    window.setTimeout(() => setNotice(null), 5_000);
  }, []);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setRefreshing(true);
    try {
      const [overviewResult, certificateResult] = await Promise.all([api.overview(), api.certificates()]);
      setOverview(overviewResult);
      setCertificates(certificateResult.certificates);
      setFatalError(null);
    } catch (error) {
      setFatalError(error instanceof Error ? error.message : "Unable to connect to the Worker API");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(true);
    const interval = window.setInterval(() => void load(true), 12_000);
    return () => window.clearInterval(interval);
  }, [load]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return certificates;
    return certificates.filter((certificate) =>
      certificate.name.toLowerCase().includes(normalized)
      || certificate.domains.some((domain) => domain.includes(normalized))
      || certificate.authority.includes(normalized),
    );
  }, [certificates, query]);

  async function act(id: string, action: () => Promise<unknown>, success: string) {
    setBusyId(id);
    try {
      await action();
      notify(success);
      await load(true);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Operation failed", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function prepareDownload(certificate: Certificate) {
    const requestId = ++downloadRequest.current;
    setDownloadState({ certificate, link: null, loading: true, error: null });
    try {
      const link = await api.downloadLink(certificate.id);
      if (downloadRequest.current === requestId) {
        setDownloadState({ certificate, link, loading: false, error: null });
      }
    } catch (error) {
      if (downloadRequest.current === requestId) {
        setDownloadState({
          certificate, link: null, loading: false,
          error: error instanceof Error ? error.message : "Unable to create a download address",
        });
      }
    }
  }

  function closeDownload() {
    downloadRequest.current += 1;
    setDownloadState(null);
  }

  const stats = [
    { label: "Total certificates", value: overview.summary.total, note: "Inventory" },
    { label: "Active", value: overview.summary.active, note: "Valid certificates" },
    { label: "Expiring soon", value: overview.summary.expiring, note: "Within 30 days" },
    { label: "Automatic renewal", value: overview.summary.autoRenew, note: "Enabled" },
  ];

  return (
    <div className="min-h-screen bg-white text-ink">
      <header className="sticky top-0 z-40 border-b border-gridline bg-white/95 backdrop-blur-xl">
        <div className="page-shell flex h-16 items-center justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-[4px] bg-ember-orange text-white">
              <LockKeyhole className="size-4" />
            </span>
            <div className="flex min-w-0 items-center gap-2">
              <p className="truncate text-sm font-medium">Cert Console</p>
              <span className="hidden text-stone min-[420px]:inline">/</span>
              <p className="hidden truncate text-sm text-slate min-[420px]:block">Certificates</p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <span className="hidden items-center gap-2 rounded-[4px] bg-vellum px-3 py-2 font-mono text-[11px] uppercase tracking-[0.02em] text-slate ring-1 ring-gridline sm:flex">
              <span className={cn("size-1.5 rounded-full", fatalError ? "bg-ink" : "bg-ember-orange")} />
              {fatalError ? "Disconnected" : "Access verified"}
            </span>
            <Button className="px-2.5 min-[380px]:px-3.5" size="sm" onClick={() => setCreateOpen(true)}><Plus /> <span className="hidden min-[380px]:inline">New certificate</span></Button>
          </div>
        </div>
      </header>

      {notice && (
          <div className="fixed left-4 right-4 top-20 z-[70] flex max-w-sm items-start gap-3 rounded-[4px] bg-ink px-4 py-3 text-sm text-white shadow-xl sm:left-auto sm:right-5">
            {notice.kind === "success" ? <Check className="mt-0.5 size-4 text-ember-orange" /> : <CircleAlert className="mt-0.5 size-4" />}
            <span className="leading-5">{notice.message}</span>
            <button className="rounded-[3px] p-0.5 hover:bg-white/10" onClick={() => setNotice(null)} aria-label="Close notification"><X className="size-3.5 text-ash" /></button>
          </div>
      )}

        <main className="page-shell py-4 sm:py-6 lg:py-8">
          <section id="overview">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
              <div>
                <div className="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.02em] text-slate">
                  <span className="h-4 w-0.5 bg-ember-orange" /> Overview / Live
                </div>
                <h1 className="text-[22px] font-medium leading-tight tracking-[-0.01em] text-ink">Certificate overview</h1>
                <p className="mt-2 text-sm text-slate">Manage issuance, renewal, and encrypted certificate bundles.</p>
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] uppercase tracking-[0.02em] text-ash">
                  <span className="flex items-center gap-2"><span className={cn("size-1.5 rounded-full", fatalError ? "bg-ink" : "bg-ember-orange")} />{fatalError ? "API offline" : "Worker online"}</span>
                  <span className="border-l border-gridline pl-3">D1 metadata</span>
                  <span className="border-l border-gridline pl-3">R2 vault</span>
                  <span className="border-l border-gridline pl-3">Cron + Workflows</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] uppercase tracking-[0.02em] text-ash">Syncs every 12 seconds</span>
                <Button variant="outline" size="icon" onClick={() => void load()} disabled={refreshing} aria-label="Refresh data">
                  <RefreshCw className={cn(refreshing && "animate-spin")} />
                </Button>
              </div>
            </div>

            {fatalError && (
              <div className="mt-5 flex items-start gap-3 rounded-[4px] bg-vellum p-4 text-sm text-slate ring-1 ring-inset ring-gridline">
                <CircleAlert className="mt-0.5 size-4 shrink-0 text-ember-orange" />
                <div><p className="font-medium text-ink">Worker API unavailable</p><p className="mt-1 text-xs">{fatalError}</p></div>
              </div>
            )}

            <div className="mt-6 grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 xl:grid-cols-4">
              {stats.map((item) => (
                <div key={item.label} className="rounded-[4px] bg-vellum p-4 ring-1 ring-gridline sm:p-5">
                  <div>
                    <p className="text-sm font-medium text-ink">{item.label}</p>
                    <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.02em] text-ash">{item.note}</p>
                  </div>
                  <p className="mt-6 text-[28px] font-medium leading-tight tracking-[-0.02em] text-ink">{loading ? "—" : item.value}</p>
                </div>
              ))}
            </div>
          </section>

          <div className="mt-6 space-y-6">
            <section id="certificates" className="min-w-0 rounded-[4px] bg-white ring-1 ring-gridline">
              <div className="flex flex-col justify-between gap-3 border-b border-gridline p-4 sm:flex-row sm:items-center sm:px-5">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-medium text-ink">Certificates</h2>
                    <Badge>{certificates.length}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-slate">Let's Encrypt and Cloudflare Origin CA</p>
                </div>
                <div className="relative min-w-0 sm:w-64">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-ash" />
                  <Input className="h-9 pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name or domain" />
                </div>
              </div>

              <div className="hidden grid-cols-[minmax(220px,1.4fr)_150px_110px_150px_130px_44px] items-center gap-3 border-b border-gridline bg-vellum px-5 py-3 font-mono text-[11px] uppercase tracking-[0.02em] text-slate lg:grid">
                <span>Name / Domains</span><span>Authority</span><span>Status</span><span>Expires</span><span>Auto renewal</span><span />
              </div>

              {loading ? (
                <div className="flex h-64 items-center justify-center gap-2 font-mono text-xs uppercase tracking-[0.02em] text-slate">
                  <LoaderCircle className="size-4 animate-spin text-ember-orange" /> Loading inventory
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex min-h-72 flex-col items-center justify-center p-8 text-center">
                  <div className="mb-4 flex size-10 items-center justify-center rounded-[4px] bg-vellum text-ember-orange ring-1 ring-gridline"><FileKey2 className="size-4" /></div>
                  <p className="text-sm font-medium text-ink">{query ? "No matching certificates" : "No certificates yet"}</p>
                  <p className="mt-1 max-w-xs text-xs leading-5 text-slate">{query ? "Try another name or domain." : "Create a certificate to see its issuance status here."}</p>
                  {!query && <Button className="mt-5" size="sm" onClick={() => setCreateOpen(true)}><Plus /> New certificate</Button>}
                </div>
              ) : filtered.map((certificate) => (
                <div
                  key={certificate.id}
                  className="grid gap-4 border-b border-gridline px-4 py-4 last:border-0 sm:px-5 lg:grid-cols-[minmax(220px,1.4fr)_150px_110px_150px_130px_44px] lg:items-center lg:gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-[3px] bg-vellum text-slate ring-1 ring-gridline"><KeyRound className="size-3" /></span>
                      <p className="truncate text-sm font-medium text-ink">{certificate.name}</p>
                    </div>
                    <p className="mt-1.5 truncate pl-9 font-mono text-[12px] text-slate" title={certificate.domains.join(", ")}>{certificate.domains.join(" · ")}</p>
                    {certificate.lastError && <p className="mt-2 line-clamp-1 pl-9 text-xs text-slate">{certificate.lastError}</p>}
                  </div>
                  <div className="flex items-center justify-between lg:block">
                    <span className="font-mono text-[11px] uppercase tracking-[0.02em] text-ash lg:hidden">CA</span>
                    <span className="text-xs text-graphite">{certificate.authority === "letsencrypt" ? "Let's Encrypt" : "CF Origin CA"}</span>
                  </div>
                  <div className="flex items-center justify-between lg:block">
                    <span className="font-mono text-[11px] uppercase tracking-[0.02em] text-ash lg:hidden">Status</span>
                    <StatusBadge status={certificate.status} />
                  </div>
                  <div className="flex items-center justify-between lg:block">
                    <span className="font-mono text-[11px] uppercase tracking-[0.02em] text-ash lg:hidden">Expires</span>
                    <div className="text-right lg:text-left">
                      <p className="text-xs text-graphite">{formatDate(certificate.expiresAt)}</p>
                      <p className="mt-1 font-mono text-[11px] text-ash">{relativeExpiry(certificate.expiresAt)}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[11px] uppercase tracking-[0.02em] text-ash lg:hidden">Auto renewal</span>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={certificate.autoRenew}
                        disabled={busyId === certificate.id}
                        onCheckedChange={(enabled) => void act(certificate.id, () => api.setAutoRenew(certificate.id, enabled), enabled ? "Automatic renewal enabled" : "Automatic renewal disabled")}
                        aria-label={`${certificate.name} automatic renewal`}
                      />
                      <span className="font-mono text-[11px] text-ash">{certificate.autoRenew ? "ON" : "OFF"}</span>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <CertificateActions
                      certificate={certificate}
                      busy={busyId === certificate.id}
                      onRenew={() => void act(certificate.id, () => api.renew(certificate.id), "Renewal job started")}
                      onDownload={() => void prepareDownload(certificate)}
                      onDeploy={() => setDeploymentCertificate(certificate)}
                      onAutoRenew={(enabled) => void act(certificate.id, () => api.setAutoRenew(certificate.id, enabled), enabled ? "Automatic renewal enabled" : "Automatic renewal disabled")}
                    />
                  </div>
                </div>
              ))}
            </section>

            <section id="activity" className="rounded-[4px] bg-white ring-1 ring-gridline">
              <div className="border-b border-gridline p-4">
                <div>
                  <h2 className="text-sm font-medium text-ink">Recent jobs</h2>
                  <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.02em] text-ash">Workflow activity</p>
                </div>
              </div>
              <div className="px-4">
                {overview.recentJobs.length > 0
                  ? overview.recentJobs.map((job) => <JobLine key={job.id} job={job} />)
                  : <div className="flex h-52 flex-col items-center justify-center text-center">
                      <ServerCog className="mb-3 size-5 text-stone" />
                      <p className="font-mono text-[11px] uppercase tracking-[0.02em] text-ash">No workflow events</p>
                    </div>}
              </div>
              <div className="flex items-center justify-between border-t border-gridline bg-vellum px-4 py-3 font-mono text-[11px] uppercase tracking-[0.02em] text-slate">
                <span>Scheduler</span><span className="text-ink">02:17 UTC / Daily</span>
              </div>
            </section>
          </div>
        </main>
      <CreateCertificateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => load(true)}
        notify={notify}
      />
      <DeploymentDialog
        certificate={deploymentCertificate}
        open={deploymentCertificate !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setDeploymentCertificate(null);
        }}
        notify={notify}
      />
      {downloadState && (
        <DownloadCertificateDialog
          state={downloadState}
          onClose={closeDownload}
          onRegenerate={() => void prepareDownload(downloadState.certificate)}
        />
      )}
    </div>
  );
}
