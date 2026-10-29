/**
 * Public course catalog for the pre-rendered landing page (pages/index.tsx getStaticProps).
 * Reads only the fields the catalog cards show and turns each description into a short
 * plain-text preview, so the page HTML stays small however long the course descriptions are.
 */
import type { Db } from 'mongodb';
import { previewText } from '@/lib/plain-text';

/** Characters of description kept for a card; the card shows about three lines. */
export const CATALOG_PREVIEW_CHARS = 280;

export interface PublicCatalogCourse {
  _id: string;
  id: string;
  title: string;
  description: string;
  category: string;
  difficulty: string;
  thumbnail: string;
}

export async function loadPublicCatalog(db: Pick<Db, 'collection'>): Promise<PublicCatalogCourse[]> {
  const rows = await db.collection('courses')
    .find({}, { projection: { title: 1, description: 1, category: 1, difficulty: 1, thumbnail: 1 } })
    .toArray();
  return rows.map((row) => {
    const id = String(row._id);
    const preview = previewText(typeof row.description === 'string' ? row.description : '');
    return {
      _id: id,
      id,
      title: typeof row.title === 'string' ? row.title : '',
      description: preview.length > CATALOG_PREVIEW_CHARS ? `${preview.slice(0, CATALOG_PREVIEW_CHARS).trimEnd()}…` : preview,
      category: typeof row.category === 'string' ? row.category : '',
      difficulty: typeof row.difficulty === 'string' ? row.difficulty : '',
      thumbnail: typeof row.thumbnail === 'string' ? row.thumbnail : '',
    };
  });
}
