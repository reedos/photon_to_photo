// What the address bar is allowed to say (score loop r6). Kept small and free of the tour's text, so the entry module can use it
// before anything else loads: address.test.ts holds TOUR_STOP_COUNT to the real tour.

/** How many stops the guided tour has (learning-model.ts TOUR; the unit test compares the two). */
export const TOUR_STOP_COUNT = 10;

/** A query with the tour and shot values that mean nothing taken out. tour=77 and shot=none stayed in the address bar, and in any
 *  link shared from it. A tour past the last stop is the last stop (as tourStop reads it); a tour that is not a whole number from
 *  1 up, and a shot that is empty or not an id, are dropped. Everything else is left as it is, in its order. */
export function cleanSearch(search: string): string {
  const params = new URLSearchParams(search);
  const tour = params.get('tour');
  if (tour !== null) {
    const n = Number(tour);
    if (!tour.trim() || !Number.isInteger(n) || n < 1) params.delete('tour');
    else if (n > TOUR_STOP_COUNT) params.set('tour', String(TOUR_STOP_COUNT));
  }
  const shot = params.get('shot');
  if (shot !== null && !/^[A-Za-z0-9_-]{1,64}$/.test(shot)) params.delete('shot');
  const text = params.toString();
  return text ? `?${text}` : '';
}
