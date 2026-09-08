import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
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
import { cn } from "@/lib/utils";
import type { Authority, Certificate, CreateCertificatePayload, Job, Overview } from "@/lib/types";

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
  const [email, setEmail] = useState("");
  const [keyType, setKeyType] = useState<CreateCertificatePayload["keyType"]>("ec-p256");
  const [autoRenew, setAutoRenew] = useState(true);
  const [validity, setValidity] = useState("5475");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const domainList = domains.split(/[\n,\s]+/).map((domain) => domain.trim()).filter(Boolean);
    if (!name.trim() || domainList.length === 0 || (authority === "letsencrypt" && !email.trim())) {
      notify("Certificate name, domains, and contact email are required", "error");
      return;
    }
    setSubmitting(true);
    try {
      await api.createCertificate({
        name: name.trim(),
        authority,
        domains: domainList,
        keyType,
        autoRenew,
        renewBeforeDays: authority === "letsencrypt" ? 30 : 60,
        ...(authority === "letsencrypt" ? { acmeEmail: email.trim() } : { originValidityDays: Number(validity) }),
      });
      notify("Issuance job created");
      onOpenChange(false);
      setName("");
      setDomains("");
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
          <DialogDescription>The private key is generated in the Worker and encrypted with AES-256-GCM before it is stored in R2.</DialogDescription>
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
            <Label htmlFor="domains">Domains / SANs</Label>
            <textarea
              id="domains"
              value={domains}
              onChange={(event) => setDomains(event.target.value)}
              rows={4}
              placeholder={"example.com\n*.example.com"}
              className="w-full resize-y rounded-[4px] bg-white px-3 py-2.5 font-mono text-[14px] leading-6 text-ink ring-1 ring-inset ring-gridline placeholder:text-stone focus:outline-none focus:ring-2 focus:ring-ember-orange/20"
            />
            <p className="text-xs text-slate">Enter one domain per line. Wildcard certificates are verified automatically through Cloudflare DNS-01.</p>
          </div>

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
                  <SelectItem value="365">1 year</SelectItem>
                  <SelectItem value="730">2 years</SelectItem>
                  <SelectItem value="1095">3 years</SelectItem>
                  <SelectItem value="5475">15 years (recommended)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs leading-5 text-slate">Trusted only by Cloudflare Origin CA. The origin should accept proxied Cloudflare traffic only.</p>
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
            <Button type="submit" disabled={submitting}>
              {submitting ? <LoaderCircle className="animate-spin" /> : <Zap />}
              Create issuance job
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface CertificateActionsProps {
  certificate: Certificate;
  busy: boolean;
  onRenew: () => void;
  onDownload: () => void;
  onAutoRenew: (enabled: boolean) => void;
}

function CertificateActions({ certificate, busy, onRenew, onDownload, onAutoRenew }: CertificateActionsProps) {
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

  async function download(certificate: Certificate) {
    await act(certificate.id, async () => {
      const link = await api.downloadLink(certificate.id);
      window.location.assign(link.url);
    }, "A one-time download link was created and is valid for 5 minutes");
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
        <div className="mx-auto flex h-16 max-w-[1680px] items-center justify-between px-3 sm:px-6 lg:px-8">
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
          <div className="fixed left-4 right-4 top-20 z-50 flex max-w-sm items-start gap-3 rounded-[4px] bg-ink px-4 py-3 text-sm text-white shadow-xl sm:left-auto sm:right-5">
            {notice.kind === "success" ? <Check className="mt-0.5 size-4 text-ember-orange" /> : <CircleAlert className="mt-0.5 size-4" />}
            <span className="leading-5">{notice.message}</span>
            <button className="rounded-[3px] p-0.5 hover:bg-white/10" onClick={() => setNotice(null)} aria-label="Close notification"><X className="size-3.5 text-ash" /></button>
          </div>
      )}

        <main className="mx-auto max-w-[1680px] p-4 sm:p-6 lg:p-8">
          <section id="overview">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
              <div>
                <div className="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.02em] text-slate">
                  <span className="h-4 w-0.5 bg-ember-orange" /> Overview / Live
                </div>
                <h1 className="text-2xl font-medium tracking-[-0.01em] text-ink">Certificate overview</h1>
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
                  <p className="mt-6 text-3xl font-medium tracking-[-0.02em] text-ink">{loading ? "—" : item.value}</p>
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
                      onDownload={() => void download(certificate)}
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
    </div>
  );
}
