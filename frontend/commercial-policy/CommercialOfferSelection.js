// Presentation only: never derive prices, quotas or purchase authority.
export const COMMERCIAL_GROUPS = Object.freeze({
  basic: { label: "Cơ bản", variant: "internal" },
  advanced: { label: "Nâng cao", variant: "connected" },
});

export function commercialGroupForOffer(offer) {
  return Object.keys(COMMERCIAL_GROUPS).find(
    (group) => COMMERCIAL_GROUPS[group].variant === offer?.variant,
  ) || "";
}

function isGroupedOffer(offer) {
  return commercialGroupForOffer(offer)
    && ["account", "organization"].includes(offer?.ownerKind)
    && ["monthly", "yearly"].includes(offer?.price?.period);
}

export function selectCommercialOffers(offers, selection = {}) {
  const source = Array.isArray(offers) ? offers : [];
  const grouped = source.filter(isGroupedOffer);
  const group = Object.hasOwn(COMMERCIAL_GROUPS, selection.group) ? selection.group : "basic";
  const groupOffers = grouped.filter((offer) => commercialGroupForOffer(offer) === group);
  const buckets = new Map();
  groupOffers.forEach((offer) => {
    const key = `${offer.ownerKind}:${offer.tier}:${offer.variant}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(offer);
  });
  const cards = [...buckets].map(([key, cardOffers]) => {
    const periods = cardOffers.map((offer) => offer.price.period);
    const preferred = selection.periods?.[key];
    const period = periods.includes(preferred) ? preferred
      : periods.includes("yearly") ? "yearly" : periods[0];
    return { key, periods, period, offer: cardOffers.find((offer) => offer.price.period === period) };
  });
  return {
    group,
    grouped: grouped.length > 0,
    selected: cards.map((card) => card.offer),
    personal: cards.filter((card) => card.offer.ownerKind === "account"),
    organization: cards.filter((card) => card.offer.ownerKind === "organization"),
    additional: source.filter((offer) => !isGroupedOffer(offer)),
  };
}
