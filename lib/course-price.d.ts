export const COURSE_PRICE_KOBO: number;
export const COURSE_CURRENCY: 'NGN';
export const COURSE_PRICE_LABEL: string;
export function formatNairaFromKobo(kobo: number): string;
export const CUSTOMER_PAYS_PAYSTACK_FEES: boolean;
export const COURSE_LOCAL_CARD_TOTAL_KOBO: number;
export const COURSE_LOCAL_CARD_FEE_KOBO: number;
export function formatNairaAndKobo(kobo: number): string;
export function localCardTotalKobo(priceKobo: number): number;
