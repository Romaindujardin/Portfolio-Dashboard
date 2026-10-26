import React, { useEffect, useMemo, useState } from "react";
import {
  Building2,
  ChevronRight,
  Home,
  MapPin,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { Property, PropertyValuation } from "../../types/portfolio";
import {
  createProperty,
  deleteProperty,
  geocodeProperty,
  getValuations,
  updateProperty,
  valuateProperty,
} from "../../services/portfolioApi";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Field,
  Input,
  Modal,
  SectionHeader,
  Select,
  StatRow,
  confidenceLabel,
  formatDate,
  formatEur,
  formatPercent,
  propertyTypeLabel,
} from "./shared";

type Notify = (kind: "success" | "error", message: string) => void;

interface RealEstateTabProps {
  userId: string;
  properties: Property[];
  onReload: () => Promise<void>;
  notify: Notify;
}

const RealEstateTab: React.FC<RealEstateTabProps> = ({
  userId,
  properties,
  onReload,
  notify,
}) => {
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Property | null>(null);
  const [detail, setDetail] = useState<Property | null>(null);
  const [valuations, setValuations] = useState<PropertyValuation[]>([]);
  const [valuationsLoading, setValuationsLoading] = useState(false);
  const [manual, setManual] = useState<Property | null>(null);
  const [manualValue, setManualValue] = useState("");
  const [manualError, setManualError] = useState("");
  const [busy, setBusy] = useState(false);
  const [estimatingId, setEstimatingId] = useState<string | null>(null);
  const [geocodingId, setGeocodingId] = useState<string | null>(null);

  const totalValue = useMemo(
    () => properties.reduce((sum, property) => sum + (property.currentValue || 0), 0),
    [properties],
  );
  const totalPurchase = useMemo(
    () => properties.reduce((sum, property) => sum + (property.purchasePrice || 0), 0),
    [properties],
  );

  const openDetail = async (property: Property) => {
    setDetail(property);
    setValuations([]);
    setValuationsLoading(true);
    try {
      setValuations(await getValuations(property.id, userId));
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "Historique indisponible.");
    } finally {
      setValuationsLoading(false);
    }
  };

  const estimate = async (property: Property) => {
    setEstimatingId(property.id);
    try {
      const result = await valuateProperty(property.id, userId, "auto");
      await onReload();
      if (result.status === "OK" && result.valuation) {
        notify(
          "success",
          `Estimation : ${formatEur(result.valuation.estimatedValue)}` +
            (result.valuation.lowValue != null && result.valuation.highValue != null
              ? ` (fourchette ${formatEur(result.valuation.lowValue)} – ${formatEur(
                  result.valuation.highValue,
                )})`
              : ""),
        );
      } else {
        notify("error", result.message || "Aucune donnée comparable pour ce bien.");
      }
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "Estimation impossible.");
    } finally {
      setEstimatingId(null);
    }
  };

  const geocode = async (property: Property) => {
    setGeocodingId(property.id);
    try {
      const updated = await geocodeProperty(property.id, userId);
      await onReload();
      notify(
        "success",
        `Adresse géocodée : ${updated.inseeCode || "code INSEE absent"} · confiance ${formatPercent(
          (updated.geocodeScore || 0) * 100,
          0,
        )}.`,
      );
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "Géocodage impossible.");
    } finally {
      setGeocodingId(null);
    }
  };

  const saveManual = async () => {
    if (!manual) return;
    const value = Number(manualValue.replace(",", "."));
    if (!Number.isFinite(value) || value < 0) {
      setManualError("Saisissez une valeur positive.");
      return;
    }
    setBusy(true);
    setManualError("");
    try {
      await valuateProperty(manual.id, userId, "manual", value);
      setManual(null);
      setManualValue("");
      await onReload();
      notify("success", "Valeur manuelle enregistrée.");
    } catch (error) {
      setManualError(error instanceof Error ? error.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (property: Property) => {
    if (
      !window.confirm(
        `Supprimer « ${property.name} » ? Le compte immobilier lié sera également supprimé.`,
      )
    ) {
      return;
    }
    try {
      await deleteProperty(property.id, userId);
      await onReload();
      notify("success", "Bien supprimé.");
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "Suppression impossible.");
    }
  };

  const saveProperty = async (payload: Record<string, unknown>) => {
    if (editing) {
      await updateProperty(editing.id, userId, payload);
      setEditing(null);
      notify("success", "Bien mis à jour.");
    } else {
      await createProperty(userId, payload);
      setCreateOpen(false);
      notify("success", "Bien ajouté.");
    }
    await onReload();
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Immobilier"
        subtitle="Estimation automatique à partir des ventes DVF (Cerema), corrigée par les caractéristiques déclarées et ré-indexée par l'INSEE."
        action={
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Ajouter un bien
          </Button>
        }
      />

      <Card className="grid gap-3 px-4 py-3 sm:grid-cols-3">
        <div>
          <p className="text-[11px] text-[#6a6a6a]">Valeur estimée</p>
          <p className="text-base font-semibold tabular-nums text-[#d4b56e]">
            {formatEur(totalValue)}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-[#6a6a6a]">Prix d'achat cumulé</p>
          <p className="text-base font-semibold tabular-nums text-[#f5f5f5]">
            {formatEur(totalPurchase)}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-[#6a6a6a]">Plus-value latente</p>
          <p
            className={`text-base font-semibold tabular-nums ${
              totalValue - totalPurchase >= 0 ? "text-[#34d399]" : "text-[#f87171]"
            }`}
          >
            {formatEur(totalValue - totalPurchase, { signed: true })}
          </p>
        </div>
      </Card>

      {properties.length === 0 ? (
        <EmptyState
          icon={<Home className="h-7 w-7" />}
          title="Aucun bien immobilier"
          description="Ajoutez votre résidence principale ou un bien locatif. La valeur est estimée automatiquement à partir des ventes réelles de la commune, puis ré-indexée."
          action={
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Ajouter un bien
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {properties.map((property) => {
            const gain =
              property.currentValue != null && property.purchasePrice != null
                ? property.currentValue - property.purchasePrice
                : null;
            const gainPercent =
              gain != null && property.purchasePrice
                ? (gain / property.purchasePrice) * 100
                : null;
            return (
              <Card key={property.id} className="p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[rgba(200,165,94,0.08)]">
                    {property.propertyType === "HOUSE" ? (
                      <Home className="h-5 w-5 text-[#c8a55e]" />
                    ) : (
                      <Building2 className="h-5 w-5 text-[#c8a55e]" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-sm font-semibold text-[#f5f5f5]">
                        {property.name}
                      </h3>
                      <Badge tone={property.valuationMode === "ESTIMATED" ? "green" : "gray"}>
                        {property.valuationMode === "ESTIMATED" ? "Estimation auto" : "Manuel"}
                      </Badge>
                    </div>
                    <p className="mt-0.5 flex items-center gap-1 text-[11px] text-[#6a6a6a]">
                      <MapPin className="h-3 w-3" />
                      {[property.postalCode, property.city].filter(Boolean).join(" ") ||
                        "Adresse non renseignée"}
                    </p>
                    <p className="mt-1 text-[11px] text-[#8a8a8a]">
                      {propertyTypeLabel[property.propertyType] || property.propertyType}
                      {property.surfaceM2 ? ` · ${property.surfaceM2} m²` : ""}
                      {property.rooms ? ` · ${property.rooms} pièces` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-base font-semibold tabular-nums text-[#f5f5f5]">
                      {formatEur(property.currentValue)}
                    </p>
                    {property.surfaceM2 && property.currentValue ? (
                      <p className="text-[10px] text-[#6a6a6a]">
                        {formatEur(property.currentValue / property.surfaceM2)}/m²
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="mt-3 grid gap-3 border-t border-[rgba(255,255,255,0.06)] pt-3 sm:grid-cols-2">
                  <div>
                    <StatRow label="Prix d'achat" value={formatEur(property.purchasePrice)} />
                    <StatRow label="Dernière estimation" value={formatDate(property.lastValuedAt)} />
                  </div>
                  <div>
                    <StatRow
                      label="Plus-value"
                      value={gain == null ? "—" : formatEur(gain, { signed: true })}
                      hint={gainPercent == null ? undefined : formatPercent(gainPercent, 1)}
                      emphasis={gain != null && gain >= 0}
                    />
                    <StatRow
                      label="Code INSEE"
                      value={property.inseeCode || "non géocodé"}
                    />
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-[rgba(255,255,255,0.06)] pt-3">
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => estimate(property)}
                    loading={estimatingId === property.id}
                  >
                    <Sparkles className="h-3.5 w-3.5" /> Estimer
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      setManual(property);
                      setManualValue(String(property.currentValue ?? ""));
                      setManualError("");
                    }}
                  >
                    Valeur manuelle
                  </Button>
                  <Button size="sm" onClick={() => openDetail(property)}>
                    Détail <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => geocode(property)}
                    loading={geocodingId === property.id}
                    title="Géocoder l'adresse via IGN"
                  >
                    <MapPin className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(property)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(property)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <PropertyFormModal
        open={createOpen}
        title="Ajouter un bien"
        onClose={() => setCreateOpen(false)}
        onSubmit={saveProperty}
      />
      <PropertyFormModal
        open={Boolean(editing)}
        title="Modifier le bien"
        initial={editing}
        onClose={() => setEditing(null)}
        onSubmit={saveProperty}
      />

      {/* Valeur manuelle */}
      <Modal
        open={Boolean(manual)}
        title={`Valeur manuelle — ${manual?.name || ""}`}
        onClose={() => setManual(null)}
        footer={
          <>
            <Button onClick={() => setManual(null)}>Annuler</Button>
            <Button variant="primary" onClick={saveManual} loading={busy}>
              Enregistrer
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {manualError && <ErrorBanner message={manualError} onClose={() => setManualError("")} />}
          <p className="text-xs text-[#8a8a8a]">
            Utilisez cette option si l'estimation automatique n'est pas disponible (département
            non couvert, bien atypique) ou si vous avez une expertise récente.
          </p>
          <Field label="Valeur du bien (€)" required>
            <Input
              inputMode="decimal"
              value={manualValue}
              onChange={(event) => setManualValue(event.target.value)}
              placeholder="350000"
            />
          </Field>
        </div>
      </Modal>

      {/* Détail / historique */}
      <Modal
        open={Boolean(detail)}
        wide
        title={`Détail — ${detail?.name || ""}`}
        onClose={() => setDetail(null)}
        footer={<Button onClick={() => setDetail(null)}>Fermer</Button>}
      >
        {detail && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Card className="p-3">
                <p className="text-[11px] text-[#6a6a6a]">Valeur actuelle</p>
                <p className="text-sm font-semibold text-[#d4b56e]">
                  {formatEur(detail.currentValue)}
                </p>
              </Card>
              <Card className="p-3">
                <p className="text-[11px] text-[#6a6a6a]">Surface</p>
                <p className="text-sm font-semibold text-[#f5f5f5]">
                  {detail.surfaceM2 ? `${detail.surfaceM2} m²` : "—"}
                </p>
              </Card>
              <Card className="p-3">
                <p className="text-[11px] text-[#6a6a6a]">Prix / m²</p>
                <p className="text-sm font-semibold text-[#f5f5f5]">
                  {detail.currentValue && detail.surfaceM2
                    ? formatEur(detail.currentValue / detail.surfaceM2)
                    : "—"}
                </p>
              </Card>
            </div>

            {valuationsLoading ? (
              <p className="py-4 text-center text-xs text-[#8a8a8a]">Chargement…</p>
            ) : valuations.length === 0 ? (
              <p className="text-xs text-[#8a8a8a]">Aucune estimation enregistrée.</p>
            ) : (
              <div className="space-y-3">
                {(() => {
                  const latest = valuations[0];
                  return (
                    <div className="rounded-lg border border-[rgba(255,255,255,0.07)] p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-medium text-[#f5f5f5]">
                          Dernière estimation · {formatDate(latest.valuedAt)}
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge tone="gold">{latest.provider}</Badge>
                          <Badge
                            tone={
                              latest.confidence === "HIGH"
                                ? "green"
                                : latest.confidence === "MEDIUM"
                                  ? "blue"
                                  : "gray"
                            }
                          >
                            Confiance {confidenceLabel[latest.confidence || ""] || "—"}
                          </Badge>
                        </div>
                      </div>
                      <div className="mt-2 grid gap-2 sm:grid-cols-3">
                        <StatRow label="Estimation" value={formatEur(latest.estimatedValue)} emphasis />
                        <StatRow label="Fourchette basse" value={formatEur(latest.lowValue)} />
                        <StatRow label="Fourchette haute" value={formatEur(latest.highValue)} />
                        <StatRow label="Prix médian / m²" value={formatEur(latest.pricePerSqm)} />
                        <StatRow
                          label="Ventes comparables"
                          value={latest.sampleSize == null ? "—" : String(latest.sampleSize)}
                        />
                        <StatRow
                          label="Millésime DVF"
                          value={latest.sourceYear == null ? "—" : String(latest.sourceYear)}
                        />
                      </div>
                      {latest.detail?.adjustments && latest.detail.adjustments.length > 0 && (
                        <div className="mt-3">
                          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-[#6a6a6a]">
                            Corrections appliquées
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {latest.detail.adjustments.map((adjustment, index) => (
                              <span
                                key={`${adjustment.code}-${index}`}
                                className="rounded-md border border-[rgba(255,255,255,0.08)] bg-[#0d0d0d] px-2 py-1 text-[10px] text-[#b0b0b0]"
                              >
                                {adjustmentLabel(adjustment.code)}
                                {adjustment.factor != null
                                  ? ` ${adjustment.factor > 0 ? "+" : ""}${formatPercent(
                                      adjustment.factor * 100,
                                      1,
                                    )}`
                                  : ""}
                                {adjustment.sqm != null ? ` · ${adjustment.sqm} m²` : ""}
                                {adjustment.amount != null ? ` · ${formatEur(adjustment.amount)}` : ""}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {latest.detail?.reindexed && latest.detail.reindexRatio != null && (
                        <p className="mt-2 text-[10px] text-[#6a6a6a]">
                          Ré-indexation INSEE appliquée : ×{latest.detail.reindexRatio.toFixed(4)}
                        </p>
                      )}
                    </div>
                  );
                })()}

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[11px]">
                    <thead className="text-[#6a6a6a]">
                      <tr className="border-b border-[rgba(255,255,255,0.06)]">
                        <th className="py-2 pr-2 font-medium">Date</th>
                        <th className="py-2 pr-2 font-medium">Valeur</th>
                        <th className="py-2 pr-2 font-medium">Source</th>
                        <th className="py-2 font-medium">Confiance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {valuations.map((valuation) => (
                        <tr
                          key={valuation.id}
                          className="border-b border-[rgba(255,255,255,0.04)]"
                        >
                          <td className="py-2 pr-2 text-[#b0b0b0]">
                            {formatDate(valuation.valuedAt)}
                          </td>
                          <td className="py-2 pr-2 tabular-nums text-[#f5f5f5]">
                            {formatEur(valuation.estimatedValue)}
                          </td>
                          <td className="py-2 pr-2 text-[#8a8a8a]">{valuation.provider}</td>
                          <td className="py-2 text-[#8a8a8a]">
                            {confidenceLabel[valuation.confidence || ""] || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};

// ─── Formulaire ─────────────────────────────────────────────────────────────

interface PropertyFormState {
  name: string;
  address: string;
  postal_code: string;
  city: string;
  property_type: string;
  surface_m2: string;
  land_m2: string;
  rooms: string;
  bedrooms: string;
  bathrooms: string;
  floor_number: string;
  floors_total: string;
  has_elevator: boolean;
  has_garden: boolean;
  has_terrace: boolean;
  has_balcony: boolean;
  garage_count: string;
  parking_count: string;
  construction_year: string;
  energy_class: string;
  purchase_price: string;
  purchase_date: string;
  agency_fees: string;
  notary_fees: string;
  works_cost: string;
  rental_income: string;
  current_value: string;
}

const emptyForm: PropertyFormState = {
  name: "",
  address: "",
  postal_code: "",
  city: "",
  property_type: "APARTMENT",
  surface_m2: "",
  land_m2: "",
  rooms: "",
  bedrooms: "",
  bathrooms: "",
  floor_number: "",
  floors_total: "",
  has_elevator: false,
  has_garden: false,
  has_terrace: false,
  has_balcony: false,
  garage_count: "0",
  parking_count: "0",
  construction_year: "",
  energy_class: "",
  purchase_price: "",
  purchase_date: "",
  agency_fees: "",
  notary_fees: "",
  works_cost: "",
  rental_income: "0",
  current_value: "",
};

const toForm = (property: Property): PropertyFormState => ({
  name: property.name || "",
  address: property.address || "",
  postal_code: property.postalCode || "",
  city: property.city || "",
  property_type: property.propertyType || "APARTMENT",
  surface_m2: property.surfaceM2 == null ? "" : String(property.surfaceM2),
  land_m2: property.landM2 == null ? "" : String(property.landM2),
  rooms: property.rooms == null ? "" : String(property.rooms),
  bedrooms: property.bedrooms == null ? "" : String(property.bedrooms),
  bathrooms: property.bathrooms == null ? "" : String(property.bathrooms),
  floor_number: property.floorNumber == null ? "" : String(property.floorNumber),
  floors_total: property.floorsTotal == null ? "" : String(property.floorsTotal),
  has_elevator: property.hasElevator,
  has_garden: property.hasGarden,
  has_terrace: property.hasTerrace,
  has_balcony: property.hasBalcony,
  garage_count: String(property.garageCount ?? 0),
  parking_count: String(property.parkingCount ?? 0),
  construction_year: property.constructionYear == null ? "" : String(property.constructionYear),
  energy_class: property.energyClass || "",
  purchase_price: property.purchasePrice == null ? "" : String(property.purchasePrice),
  purchase_date: property.purchaseDate || "",
  agency_fees: property.agencyFees == null ? "" : String(property.agencyFees),
  notary_fees: property.notaryFees == null ? "" : String(property.notaryFees),
  works_cost: property.worksCost == null ? "" : String(property.worksCost),
  rental_income: String(property.rentalIncome ?? 0),
  current_value: property.currentValue == null ? "" : String(property.currentValue),
});

const toNumber = (value: string): number | null => {
  const normalized = value.trim().replace(/\s/g, "").replace(",", ".");
  if (normalized === "") return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
};

const toInt = (value: string): number | null => {
  const number = toNumber(value);
  return number == null ? null : Math.round(number);
};

const PropertyFormModal: React.FC<{
  open: boolean;
  title: string;
  initial?: Property | null;
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
}> = ({ open, title, initial, onClose, onSubmit }) => {
  const [form, setForm] = useState<PropertyFormState>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setForm(initial ? toForm(initial) : emptyForm);
    setError("");
  }, [open, initial]);

  const update = <K extends keyof PropertyFormState>(key: K, value: PropertyFormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async () => {
    if (!form.name.trim()) {
      setError("Le nom du bien est requis.");
      return;
    }
    if (
      ["HOUSE", "APARTMENT"].includes(form.property_type) &&
      (toNumber(form.surface_m2) == null || (toNumber(form.surface_m2) || 0) <= 0)
    ) {
      setError("La surface habitable est requise pour une maison ou un appartement.");
      return;
    }
    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      address: form.address.trim() || null,
      postal_code: form.postal_code.trim() || null,
      city: form.city.trim() || null,
      property_type: form.property_type,
      surface_m2: toNumber(form.surface_m2),
      land_m2: toNumber(form.land_m2),
      rooms: toInt(form.rooms),
      bedrooms: toInt(form.bedrooms),
      bathrooms: toInt(form.bathrooms),
      floor_number: toInt(form.floor_number),
      floors_total: toInt(form.floors_total),
      has_elevator: form.has_elevator,
      has_garden: form.has_garden,
      has_terrace: form.has_terrace,
      has_balcony: form.has_balcony,
      garage_count: toInt(form.garage_count) || 0,
      parking_count: toInt(form.parking_count) || 0,
      construction_year: toInt(form.construction_year),
      energy_class: form.energy_class || null,
      purchase_price: toNumber(form.purchase_price),
      purchase_date: form.purchase_date || null,
      agency_fees: toNumber(form.agency_fees),
      notary_fees: toNumber(form.notary_fees),
      works_cost: toNumber(form.works_cost),
      rental_income: toNumber(form.rental_income) || 0,
    };
    const currentValue = toNumber(form.current_value);
    if (initial) {
      if (currentValue !== initial.currentValue) payload.current_value = currentValue;
    } else if (currentValue != null) {
      payload.current_value = currentValue;
    }

    setBusy(true);
    setError("");
    try {
      await onSubmit(payload);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  };

  const isApartment = form.property_type === "APARTMENT";
  const isHouse = form.property_type === "HOUSE";

  return (
    <Modal
      open={open}
      wide
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            {initial ? "Enregistrer" : "Ajouter"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <ErrorBanner message={error} onClose={() => setError("")} />}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nom du bien" required>
            <Input
              value={form.name}
              onChange={(event) => update("name", event.target.value)}
              placeholder="Résidence principale, studio Lyon…"
            />
          </Field>
          <Field label="Type" required>
            <Select
              value={form.property_type}
              onChange={(event) => update("property_type", event.target.value)}
            >
              <option value="APARTMENT">Appartement</option>
              <option value="HOUSE">Maison</option>
              <option value="OTHER">Autre</option>
            </Select>
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Adresse" className="sm:col-span-2">
            <Input
              value={form.address}
              onChange={(event) => update("address", event.target.value)}
              placeholder="12 rue des Lilas"
            />
          </Field>
          <Field label="Code postal">
            <Input
              value={form.postal_code}
              onChange={(event) => update("postal_code", event.target.value)}
              placeholder="75011"
            />
          </Field>
          <Field label="Ville" className="sm:col-span-2">
            <Input
              value={form.city}
              onChange={(event) => update("city", event.target.value)}
              placeholder="Paris"
            />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Surface habitable (m²)" required={isApartment || isHouse}>
            <Input
              inputMode="decimal"
              value={form.surface_m2}
              onChange={(event) => update("surface_m2", event.target.value)}
            />
          </Field>
          <Field label="Terrain (m²)">
            <Input
              inputMode="decimal"
              value={form.land_m2}
              onChange={(event) => update("land_m2", event.target.value)}
            />
          </Field>
          <Field label="Pièces">
            <Input
              inputMode="numeric"
              value={form.rooms}
              onChange={(event) => update("rooms", event.target.value)}
            />
          </Field>
          <Field label="Chambres">
            <Input
              inputMode="numeric"
              value={form.bedrooms}
              onChange={(event) => update("bedrooms", event.target.value)}
            />
          </Field>
          <Field label="Salles de bain">
            <Input
              inputMode="numeric"
              value={form.bathrooms}
              onChange={(event) => update("bathrooms", event.target.value)}
            />
          </Field>
          <Field label="Étage">
            <Input
              inputMode="numeric"
              value={form.floor_number}
              onChange={(event) => update("floor_number", event.target.value)}
              placeholder="0 = RDC"
            />
          </Field>
          <Field label="Étages de l'immeuble">
            <Input
              inputMode="numeric"
              value={form.floors_total}
              onChange={(event) => update("floors_total", event.target.value)}
            />
          </Field>
          <Field label="Année de construction">
            <Input
              inputMode="numeric"
              value={form.construction_year}
              onChange={(event) => update("construction_year", event.target.value)}
              placeholder="1998"
            />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Garages">
            <Input
              inputMode="numeric"
              value={form.garage_count}
              onChange={(event) => update("garage_count", event.target.value)}
            />
          </Field>
          <Field label="Parkings">
            <Input
              inputMode="numeric"
              value={form.parking_count}
              onChange={(event) => update("parking_count", event.target.value)}
            />
          </Field>
          <Field label="DPE" hint="Prioritaire sur l'année de construction.">
            <Select
              value={form.energy_class}
              onChange={(event) => update("energy_class", event.target.value)}
            >
              <option value="">Non renseigné</option>
              {["A", "B", "C", "D", "E", "F", "G"].map((letter) => (
                <option key={letter} value={letter}>
                  {letter}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex flex-col justify-end gap-1.5 pb-1">
            {(
              [
                ["has_elevator", "Ascenseur"],
                ["has_garden", "Jardin"],
                ["has_terrace", "Terrasse"],
                ["has_balcony", "Balcon"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-xs text-[#b0b0b0]">
                <input
                  type="checkbox"
                  checked={form[key]}
                  onChange={(event) => update(key, event.target.checked)}
                  className="h-3.5 w-3.5 rounded border-[rgba(255,255,255,0.2)] bg-[#0d0d0d] accent-[#c8a55e]"
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Prix d'achat (€)">
            <Input
              inputMode="decimal"
              value={form.purchase_price}
              onChange={(event) => update("purchase_price", event.target.value)}
            />
          </Field>
          <Field label="Date d'achat">
            <Input
              type="date"
              value={form.purchase_date}
              onChange={(event) => update("purchase_date", event.target.value)}
            />
          </Field>
          <Field label="Frais d'agence (€)">
            <Input
              inputMode="decimal"
              value={form.agency_fees}
              onChange={(event) => update("agency_fees", event.target.value)}
            />
          </Field>
          <Field label="Frais de notaire (€)">
            <Input
              inputMode="decimal"
              value={form.notary_fees}
              onChange={(event) => update("notary_fees", event.target.value)}
            />
          </Field>
          <Field label="Travaux (€)">
            <Input
              inputMode="decimal"
              value={form.works_cost}
              onChange={(event) => update("works_cost", event.target.value)}
            />
          </Field>
          <Field label="Loyer annuel (€)">
            <Input
              inputMode="decimal"
              value={form.rental_income}
              onChange={(event) => update("rental_income", event.target.value)}
            />
          </Field>
          <Field
            label="Valeur actuelle (€)"
            hint={initial ? "Modifier cette valeur la passe en manuel." : "Optionnel : sinon prix d'achat."}
          >
            <Input
              inputMode="decimal"
              value={form.current_value}
              onChange={(event) => update("current_value", event.target.value)}
            />
          </Field>
        </div>

        <p className="rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#0d0d0d] px-3 py-2 text-[11px] text-[#6a6a6a]">
          L'estimation automatique géocode l'adresse, récupère la médiane des ventes de la
          commune (DVF/Cerema), applique les corrections déclarées puis ré-indexe avec l'indice
          INSEE. Les départements 57, 67, 68 et 976 ne sont pas couverts par DVF.
        </p>
      </div>
    </Modal>
  );
};

const adjustmentLabel = (code: string): string => {
  const labels: Record<string, string> = {
    GROUND_FLOOR: "Rez-de-chaussée",
    NO_ELEVATOR: "Sans ascenseur",
    TOP_FLOOR_ELEVATOR: "Dernier étage avec ascenseur",
    GARDEN: "Jardin",
    TERRACE: "Terrasse",
    BALCONY: "Balcon",
    EXTRA_BATHROOMS: "Salles de bain suppl.",
    ENERGY_A: "DPE A",
    ENERGY_B: "DPE B",
    ENERGY_C: "DPE C",
    ENERGY_E: "DPE E",
    ENERGY_F: "DPE F",
    ENERGY_G: "DPE G",
    ERA_PRE_1949: "Avant 1949",
    ERA_1949_1974: "1949–1974",
    ERA_2001_2012: "2001–2012",
    ERA_POST_2012: "Après 2012",
    GARAGE: "Garage",
    PARKING: "Parking",
    LAND_SURPLUS: "Terrain > 500 m²",
  };
  return labels[code] || code;
};

export default RealEstateTab;
