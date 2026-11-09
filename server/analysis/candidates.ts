import type { Card } from "../../shared/types.ts";

export interface ScoredCard {
  card: Card;
  score: number;
  inclusion: number | null;
  synergy: number | null;
  comboPiece: boolean;
  offIdentity: boolean;
  source: string[];
}
