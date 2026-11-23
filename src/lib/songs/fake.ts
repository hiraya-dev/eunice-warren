export interface SongSuggestion {
  id: string;
  title: string;
  artist: string;
  album: string;
  cover: string | null;
}

export const fakeSongSuggestions: SongSuggestion[] = [
  { id: "0000000000000000000001", title: "Dancing Queen", artist: "ABBA", album: "Arrival", cover: null },
  { id: "0000000000000000000002", title: "Dancing in the Moonlight", artist: "Toploader", album: "Onka's Big Moka", cover: null },
  { id: "0000000000000000000003", title: "Sweet Dreams", artist: "Eurythmics", album: "Sweet Dreams (Are Made of This)", cover: null },
  { id: "0000000000000000000004", title: "Mr. Brightside", artist: "The Killers", album: "Hot Fuss", cover: null },
  { id: "0000000000000000000005", title: "Everybody (Backstreet's Back)", artist: "Backstreet Boys", album: "Backstreet's Back", cover: null },
  { id: "0000000000000000000006", title: "Island in the Sun", artist: "Weezer", album: "Weezer", cover: null },
  { id: "0000000000000000000007", title: "Sunrise Together", artist: "Sample Duo, Sample Crew", album: "Boracay Sampler", cover: null },
  { id: "0000000000000000000008", title: "Wonderwall", artist: "Oasis", album: "(What's the Story) Morning Glory?", cover: null },
];

export function fakeSongSearch(query: string) {
  const wanted = query.toLocaleLowerCase();
  return fakeSongSuggestions.filter((song) =>
    `${song.title} ${song.artist}`.toLocaleLowerCase().includes(wanted),
  ).slice(0, 5);
}
