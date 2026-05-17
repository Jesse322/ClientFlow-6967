import { useState, useEffect, useRef, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { updateClient, uploadClientHeaderPhoto, deleteClientHeaderPhoto, searchUnsplash, triggerUnsplashDownload } from "@/lib/api";
import type { AirtableRecord, Client } from "@/lib/types";
import type { UnsplashPhoto } from "@/lib/api";
import { Search, Upload, X, Check, Loader2, ImageOff, Hash } from "lucide-react";

// ── Color palette ─────────────────────────────────────────────────────────────
const COLORS = [
  { label: "Default", value: null, bg: "bg-slate-100", ring: "ring-slate-300" },
  { label: "Sky", value: "#0ea5e9", bg: "bg-sky-500", ring: "ring-sky-400" },
  { label: "Indigo", value: "#6366f1", bg: "bg-indigo-500", ring: "ring-indigo-400" },
  { label: "Violet", value: "#8b5cf6", bg: "bg-violet-500", ring: "ring-violet-400" },
  { label: "Emerald", value: "#10b981", bg: "bg-emerald-500", ring: "ring-emerald-400" },
  { label: "Rose", value: "#f43f5e", bg: "bg-rose-500", ring: "ring-rose-400" },
  { label: "Amber", value: "#f59e0b", bg: "bg-amber-500", ring: "ring-amber-400" },
  { label: "Orange", value: "#f97316", bg: "bg-orange-500", ring: "ring-orange-400" },
  { label: "Slate", value: "#475569", bg: "bg-slate-600", ring: "ring-slate-500" },
];

interface Props {
  client: AirtableRecord<Client>;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

type PhotoTab = "unsplash" | "upload";

export function CustomizeClientModal({ client, open, onClose, onSaved }: Props) {
  const f = client.fields;

  // ── State ──────────────────────────────────────────────────────────────────
  const [selectedColor, setSelectedColor] = useState<string | null>(f["Theme Color"] || null);
  const [hexInput, setHexInput] = useState<string>(f["Theme Color"] || "");
  const [hexError, setHexError] = useState(false);
  const [photoTab, setPhotoTab] = useState<PhotoTab>("unsplash");
  const [saving, setSaving] = useState(false);

  // Unsplash state
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UnsplashPhoto[]>([]);
  const [searching, setSearching] = useState(false);
  const [totalPages, setTotalPages] = useState(0);
  const [page, setPage] = useState(1);
  const [selectedUnsplash, setSelectedUnsplash] = useState<UnsplashPhoto | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Upload state
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Current photo (from existing client data)
  const currentPhotoUrl = f["Header Photo URL"];
  const currentPhotoSource = f["Header Photo Source"];
  const currentCredit = f["Header Photo Credit"];

  // Reset on open
  useEffect(() => {
    if (open) {
      setSelectedColor(f["Theme Color"] || null);
      setHexInput(f["Theme Color"] || "");
      setHexError(false);
      setSelectedUnsplash(null);
      setUploadFile(null);
      setUploadPreview(null);
      setQuery("");
      setResults([]);
      setPage(1);
    }
  }, [open]);

  // Unsplash search with debounce
  const doSearch = useCallback(async (q: string, p: number) => {
    if (!q.trim()) { setResults([]); setTotalPages(0); return; }
    setSearching(true);
    try {
      const data = await searchUnsplash(q, p);
      setResults(data.results);
      setTotalPages(data.total_pages);
    } catch {
      toast.error("Unsplash search failed");
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setPage(1); doSearch(query, 1); }, 500);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  const handlePageChange = (p: number) => { setPage(p); doSearch(query, p); };

  // File handling
  const handleFile = (file: File) => {
    if (!file.type.startsWith("image/")) { toast.error("Please select an image file"); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error("Image must be under 5MB"); return; }
    setUploadFile(file);
    const url = URL.createObjectURL(file);
    setUploadPreview(url);
    setSelectedUnsplash(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  // Save
  const handleSave = async () => {
    setSaving(true);
    try {
      const fields: Partial<Client> = {};

      // Color
      if (selectedColor !== (f["Theme Color"] || null)) {
        fields["Theme Color"] = selectedColor;
      }

      // Photo
      if (uploadFile) {
        // Upload to R2
        await uploadClientHeaderPhoto(client.id, uploadFile);
        // Color-only fields still need saving separately if changed
        if (Object.keys(fields).length > 0) await updateClient(client.id, fields);
      } else if (selectedUnsplash) {
        // Unsplash — hotlink + save metadata
        // Fire-and-forget — required by Unsplash guidelines but shouldn't block save
        triggerUnsplashDownload(selectedUnsplash.download_location).catch(() => {});
        fields["Header Photo URL"] = selectedUnsplash.urls.regular;
        fields["Header Photo Source"] = "unsplash";
        fields["Header Photo Credit"] = { name: selectedUnsplash.user.name, link: selectedUnsplash.user.link };
        await updateClient(client.id, fields);
      } else {
        // Just color change (or nothing)
        if (Object.keys(fields).length > 0) await updateClient(client.id, fields);
      }

      toast.success("Client page updated");
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error("Save failed: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRemovePhoto = async () => {
    setSaving(true);
    try {
      await deleteClientHeaderPhoto(client.id);
      toast.success("Photo removed");
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error("Failed to remove photo: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const hasChanges = selectedColor !== (f["Theme Color"] || null) || !!uploadFile || !!selectedUnsplash;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Customize {f["Client Name"]}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-2">

          {/* ── Color ── */}
          <div>
            <p className="text-sm font-semibold text-slate-700 mb-2">Accent Color</p>
            <div className="flex flex-wrap gap-2 mb-3">
              {COLORS.map((c) => (
                <button
                  key={c.label}
                  type="button"
                  title={c.label}
                  onClick={() => { setSelectedColor(c.value); setHexInput(c.value?.replace("#", "") || ""); setHexError(false); }}
                  className={cn(
                    "w-8 h-8 rounded-full border-2 transition-all flex items-center justify-center",
                    c.bg,
                    selectedColor === c.value
                      ? `border-slate-900 ring-2 ${c.ring} ring-offset-1`
                      : "border-transparent hover:border-slate-300"
                  )}
                >
                  {selectedColor === c.value && (
                    <Check className={cn("w-3.5 h-3.5", c.value ? "text-white" : "text-slate-600")} />
                  )}
                </button>
              ))}
            </div>

            {/* Hex input */}
            <div className="flex items-center gap-2">
              <div className="relative max-w-[200px]">
                <Hash className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-slate-400" />
                <Input
                  value={hexInput}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/[^0-9a-fA-F]/g, "").slice(0, 6);
                    setHexInput(raw);
                    if (raw.length === 6) {
                      setSelectedColor(`#${raw}`);
                      setHexError(false);
                    } else if (raw.length === 0) {
                      setSelectedColor(null);
                      setHexError(false);
                    } else {
                      setHexError(true);
                    }
                  }}
                  placeholder="Custom hex (e.g. 1a2b3c)"
                  className={cn("pl-7 text-sm font-mono", hexError && "border-rose-400 focus-visible:ring-rose-400")}
                />
              </div>
              {selectedColor && !hexError && (
                <div className="w-8 h-8 rounded-full border border-slate-200 flex-shrink-0" style={{ backgroundColor: selectedColor }} />
              )}
              {hexError && <span className="text-xs text-rose-500">Enter 6 hex digits</span>}
            </div>
          </div>

          {/* ── Photo ── */}
          <div>
            <p className="text-sm font-semibold text-slate-700 mb-2">Header Photo</p>

            {/* Current photo preview */}
            {currentPhotoUrl && !uploadFile && !selectedUnsplash && (
              <div className="mb-3 relative rounded-lg overflow-hidden h-24 bg-slate-100">
                <img
                  src={currentPhotoSource === "upload" ? `/api/clients/${client.id}/header-photo` : currentPhotoUrl}
                  alt="Current header"
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                  <span className="text-white text-xs font-medium">Current photo</span>
                </div>
                {currentCredit && (
                  <a href={currentCredit.link} target="_blank" rel="noopener noreferrer"
                    className="absolute bottom-1 right-2 text-white/70 text-[10px] hover:text-white">
                    Photo by {currentCredit.name}
                  </a>
                )}
              </div>
            )}

            {/* Upload preview */}
            {uploadPreview && (
              <div className="mb-3 relative rounded-lg overflow-hidden h-24 bg-slate-100">
                <img src={uploadPreview} alt="Upload preview" className="w-full h-full object-cover" />
                <button onClick={() => { setUploadFile(null); setUploadPreview(null); }}
                  className="absolute top-1 right-1 bg-black/50 rounded-full p-0.5 text-white hover:bg-black/70">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Selected Unsplash preview */}
            {selectedUnsplash && (
              <div className="mb-3 relative rounded-lg overflow-hidden h-24 bg-slate-100">
                <img src={selectedUnsplash.urls.small} alt={selectedUnsplash.description} className="w-full h-full object-cover" />
                <button onClick={() => setSelectedUnsplash(null)}
                  className="absolute top-1 right-1 bg-black/50 rounded-full p-0.5 text-white hover:bg-black/70">
                  <X className="w-3.5 h-3.5" />
                </button>
                <a href={selectedUnsplash.user.link} target="_blank" rel="noopener noreferrer"
                  className="absolute bottom-1 right-2 text-white/70 text-[10px] hover:text-white">
                  Photo by {selectedUnsplash.user.name} on Unsplash
                </a>
              </div>
            )}

            {/* Tabs */}
            <div className="flex gap-1 mb-3 border-b border-slate-200">
              {(["unsplash", "upload"] as PhotoTab[]).map((tab) => (
                <button key={tab} type="button"
                  onClick={() => setPhotoTab(tab)}
                  className={cn(
                    "px-3 py-1.5 text-sm font-medium border-b-2 -mb-px transition-colors capitalize",
                    photoTab === tab ? "border-sky-500 text-sky-600" : "border-transparent text-slate-500 hover:text-slate-700"
                  )}>
                  {tab === "unsplash" ? "Search Unsplash" : "Upload Photo"}
                </button>
              ))}
            </div>

            {/* Unsplash tab */}
            {photoTab === "unsplash" && (
              <div>
                <div className="relative mb-3">
                  <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-slate-400" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search photos… e.g. office, city, abstract"
                    className="pl-8 text-sm"
                  />
                  {searching && <Loader2 className="absolute right-2.5 top-2.5 w-4 h-4 text-slate-400 animate-spin" />}
                </div>

                {results.length === 0 && !searching && query && (
                  <div className="flex flex-col items-center py-6 text-slate-400">
                    <ImageOff className="w-8 h-8 mb-2" />
                    <span className="text-sm">No results for "{query}"</span>
                  </div>
                )}

                {results.length === 0 && !query && (
                  <div className="text-center py-6 text-slate-400 text-sm">
                    Search millions of free photos from Unsplash
                  </div>
                )}

                {results.length > 0 && (
                  <>
                    <div className="grid grid-cols-3 gap-2">
                      {results.map((photo) => (
                        <button
                          key={photo.id}
                          type="button"
                          onClick={() => { setSelectedUnsplash(photo); setUploadFile(null); setUploadPreview(null); }}
                          className={cn(
                            "relative rounded-lg overflow-hidden aspect-video bg-slate-100 group transition-all",
                            selectedUnsplash?.id === photo.id ? "ring-2 ring-sky-500 ring-offset-1" : "hover:ring-2 hover:ring-slate-300"
                          )}
                          style={{ backgroundColor: photo.color || "#e2e8f0" }}
                        >
                          <img src={photo.urls.thumb} alt={photo.description} className="w-full h-full object-cover" loading="lazy" />
                          {selectedUnsplash?.id === photo.id && (
                            <div className="absolute inset-0 bg-sky-500/30 flex items-center justify-center">
                              <div className="bg-sky-500 rounded-full p-0.5">
                                <Check className="w-3 h-3 text-white" />
                              </div>
                            </div>
                          )}
                          <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent p-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <p className="text-white text-[9px] truncate">{photo.user.name}</p>
                          </div>
                        </button>
                      ))}
                    </div>

                    {/* Pagination */}
                    {totalPages > 1 && (
                      <div className="flex items-center justify-center gap-2 mt-3">
                        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => handlePageChange(page - 1)}>←</Button>
                        <span className="text-xs text-slate-500">Page {page} of {totalPages}</span>
                        <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => handlePageChange(page + 1)}>→</Button>
                      </div>
                    )}

                    <p className="text-[10px] text-slate-400 mt-2 text-center">
                      Photos from <a href="https://unsplash.com" target="_blank" rel="noopener noreferrer" className="underline">Unsplash</a>
                    </p>
                  </>
                )}
              </div>
            )}

            {/* Upload tab */}
            {photoTab === "upload" && (
              <div>
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={cn(
                    "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
                    dragOver ? "border-sky-400 bg-sky-50" : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                  )}
                >
                  <Upload className="w-8 h-8 mx-auto mb-2 text-slate-400" />
                  <p className="text-sm text-slate-600 font-medium">Drop an image or click to browse</p>
                  <p className="text-xs text-slate-400 mt-1">JPG, PNG, WebP — max 5MB</p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                />
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="flex items-center justify-between">
          <div>
            {currentPhotoUrl && (
              <Button variant="ghost" size="sm" className="text-rose-500 hover:text-rose-600 hover:bg-rose-50"
                onClick={handleRemovePhoto} disabled={saving}>
                Remove photo
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !hasChanges}>
              {saving ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Saving…</> : "Save"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
