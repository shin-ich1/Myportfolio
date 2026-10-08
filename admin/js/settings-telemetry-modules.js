import {
  NAVIGATION_ICON_MAP,
  resolveModuleAdminIcon
} from "../../icon-registry.js";

const clean = (value = "") => String(value ?? "").trim();

function sectionKey(section = {}) {
  return clean(section.key || section.slug || section.id);
}

function isPromoted(section = {}) {
  const lifecycle = clean(section.lifecycle || section.promotionState || (section.promoted === true ? "promoted" : "building")).toLowerCase();
  return lifecycle === "promoted" || section.promoted === true;
}

export function buildSettingsTelemetryFeatureDescriptors(sections = [], entries = []) {
  const activeSections = (Array.isArray(sections) ? sections : [])
    .filter((section) => section && section.enabled !== false && sectionKey(section))
    .sort((first, second) => Number(first.displayOrder || 0) - Number(second.displayOrder || 0)
      || clean(first.title || sectionKey(first)).localeCompare(clean(second.title || sectionKey(second))));
  const allEntries = Array.isArray(entries) ? entries : [];
  const building = activeSections.filter((section) => !isPromoted(section));
  const promoted = activeSections.filter((section) => isPromoted(section));
  const buildingKeys = new Set(building.map(sectionKey));
  const occupiedIcons = new Set(Object.values(NAVIGATION_ICON_MAP));

  const descriptors = [{
    name: "custom-modules",
    label: "Custom Modules",
    iconName: NAVIGATION_ICON_MAP.custom,
    records: allEntries.filter((entry) => buildingKeys.has(clean(entry?.sectionKey))),
    customAggregate: true,
    moduleCount: building.length
  }];

  for (const section of promoted) {
    const key = sectionKey(section);
    const iconName = resolveModuleAdminIcon(section, { occupied: [...occupiedIcons] });
    occupiedIcons.add(iconName);
    descriptors.push({
      name: `feature:${key}`,
      label: clean(section.title) || key || "Custom Module",
      iconName,
      records: allEntries.filter((entry) => clean(entry?.sectionKey) === key),
      feature: true,
      promoted: true,
      sectionKey: key
    });
  }

  return descriptors;
}
