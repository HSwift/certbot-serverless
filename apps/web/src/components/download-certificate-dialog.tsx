import { useEffect, useState } from "react";
import { Check, CircleAlert, Copy, Download, LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import type { Certificate, DownloadLink } from "@/lib/types";

export interface DownloadDialogState {
  certificate: Certificate;
  link: DownloadLink | null;
  loading: boolean;
  error: string | null;
}

interface DownloadCertificateDialogProps {
  state: DownloadDialogState;
  onClose: () => void;
  onRegenerate: () => void;
}

export function DownloadCertificateDialog({ state, onClose, onRegenerate }: DownloadCertificateDialogProps) {
  const { certificate, link, loading, error } = state;
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [expired, setExpired] = useState(false);
  const [downloadRequested, setDownloadRequested] = useState(false);

  useEffect(() => {
    setCopied(false);
    setCopyError("");
    setDownloadRequested(false);
    const remaining = link ? new Date(link.expiresAt).getTime() - Date.now() : 0;
    setExpired(link !== null && remaining <= 0);
    if (!link || remaining <= 0) return;
    const timer = window.setTimeout(() => setExpired(true), remaining);
    return () => window.clearTimeout(timer);
  }, [link]);

  const usable = !!link && !loading && !expired && !downloadRequested;

  async function copyAddress() {
    if (!link || !usable) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setCopyError("");
    } catch {
      setCopyError("Unable to copy automatically. Select the address and copy it manually.");
    }
  }

  function download() {
    if (!link || !usable) return;
    window.location.assign(link.url);
    setDownloadRequested(true);
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-[640px]">
        <DialogHeader>
          <p className="font-mono text-[12px] uppercase tracking-[0.02em] text-slate">Certificate / Download</p>
          <DialogTitle>Download PEM bundle</DialogTitle>
          <DialogDescription className="break-words">
            Download the ZIP archive containing the certificate, chain, private key, CSR, and metadata for {certificate.name}.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-slate" role="status">
            <LoaderCircle className="size-4 animate-spin text-ember-orange" /> Preparing download address…
          </div>
        ) : error ? (
          <div className="flex items-start gap-2 rounded-[4px] bg-vellum p-4 text-sm text-slate ring-1 ring-inset ring-gridline" role="alert">
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-ember-orange" /> <span>{error}</span>
          </div>
        ) : link ? (
          <div className="grid min-w-0 gap-3">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="bundle-download-url">Download address</Label>
              <Button type="button" variant="outline" size="sm" disabled={!usable} onClick={() => void copyAddress()}>
                {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy address"}
              </Button>
            </div>
            <textarea
              id="bundle-download-url"
              value={link.url}
              readOnly
              rows={4}
              onFocus={(event) => event.target.select()}
              className="w-full resize-none break-all rounded-[4px] bg-vellum px-3 py-2.5 font-mono text-xs leading-5 text-ink ring-1 ring-inset ring-gridline focus:outline-none focus:ring-2 focus:ring-ember-orange/20"
            />
            {copyError && <p className="text-xs text-slate" role="alert">{copyError}</p>}
            <div className="grid gap-1 text-xs leading-5 text-slate" role="status">
              <p>{expired
                ? "This link has expired. Generate a new link to download."
                : downloadRequested
                  ? "Download requested. Generate a new link for another download."
                  : <>Expires <time dateTime={link.expiresAt}>{new Date(link.expiresAt).toLocaleString()}</time>.</>}</p>
              <p>This address can be used once. The download button uses the same address; copying it does not use it.</p>
            </div>
          </div>
        ) : null}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" disabled={loading} onClick={onRegenerate}>
            {loading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
            {error ? "Retry" : "Generate new link"}
          </Button>
          <Button type="button" disabled={!usable} onClick={download}>
            <Download /> Download bundle
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
