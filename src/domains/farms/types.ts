export type Visibility = 'exact' | 'approximate' | 'hidden';

/** One row from farms_in_bbox() or search_farms(). */
export interface FarmSummary {
  id: string;
  slug: string;
  name: string;
  farmer_name: string | null;
  categories: string[];
  county_code: number;
  county_name: string;
  place_name: string | null;
  lng: number | null;
  lat: number | null;
  verified: boolean;
  cover_path: string | null;
  min_price_kes: number | null;
  min_price_unit: string | null;
  listing_count: number;
  rating: number | null;
  review_count: number;
  featured: boolean;
}

export interface Listing {
  id: string;
  type: string;
  product_slug: string | null;
  title: string;
  unit: string;
  price_kes: number | null;
  quantity: number | null;
  status: string;
  product?: { name_en: string; name_sw: string; category_slug: string } | null;
}

export interface FarmDetail {
  id: string;
  slug: string;
  name: string;
  farmer_name: string | null;
  description: string | null;
  categories: string[];
  county_code: number;
  place_name: string | null;
  visibility: Visibility;
  size_acres: number | null;
  year_started: number | null;
  phone_public: string | null;
  whatsapp: string | null;
  verified_at: string | null;
  owner_id: string | null;
  managed_by: string | null;
  public_lng: number | null;
  public_lat: number | null;
  county: { name: string } | null;
  sub_county: { name: string } | null;
  listings: Listing[];
  media: { id: string; storage_path: string; position: number }[];
  rating: { avg: number | null; count: number } | null;
  created_at?: string;
  status?: string;
  featured: boolean;
}

export interface NewFarmPayload {
  name: string;
  farmer_name: string;
  phone: string;
  whatsapp_same: boolean;
  description: string;
  categories: string[];
  county_code: number;
  sub_county_id: number | null;
  place_name: string;
  visibility: Visibility;
  lng: number;
  lat: number;
  for_farmer: boolean;
  listings: { product_slug: string; price_kes: number; quantity: number | null }[];
}
