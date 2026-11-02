// Links from a topic to another Keizu map ("keizu:map/<id>#<topicId>").

export interface MapLink {
  mapId: string;
  topicId?: string;
}

export function mapLink(mapId: string, topicId?: string): string {
  return `keizu:map/${mapId}${topicId ? `#${topicId}` : ''}`;
}

export function parseMapLink(href: string | undefined): MapLink | undefined {
  const m = /^keizu:map\/([A-Za-z0-9_-]+)(?:#([A-Za-z0-9_-]+))?$/.exec(href ?? '');
  return m ? { mapId: m[1], topicId: m[2] } : undefined;
}
