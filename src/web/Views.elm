module Views exposing (Shown, ShownBracket, Suggested, hasBothViews, shown, viewOf)

{-| The two views of a deck's report: the deck as submitted and the doc's suggested version.
-}

import Route exposing (DeckView(..))
import Types exposing (BracketAssessment, BracketReport, BracketReportExcluded, Combo, DeckEdit, DeckSnapshot, DecklistCard, ManaSuggestion, Report, Swap, Synergy)


{-| What one view of a report shows: the deck it's about, and on the suggested view what the doc
changed to get there. Only that view has a deck to compare against, swaps or edits, so the deck
as submitted can't show any.
-}
type alias Shown =
    { deck : DeckSnapshot
    , bracket : Maybe ShownBracket
    , decklist : List DecklistCard
    , combosPresent : List Combo
    , combosOneAway : List Combo
    , synergies : List Synergy
    , suggested : Maybe Suggested
    }


{-| The bracket rules the report applies, and how the deck shown measures up to them.
-}
type alias ShownBracket =
    { rules : BracketReport
    , assessment : BracketAssessment
    }


{-| What the doc changed: the deck as submitted (to compare with), the swaps and why, the edits made
in chat, the land swaps it suggests, and the cards it kept out for the bracket.
-}
type alias Suggested =
    { before : DeckSnapshot
    , bracketBefore : Maybe BracketAssessment
    , swaps : List Swap
    , strategy : String
    , edits : List DeckEdit
    , manaSuggestions : List ManaSuggestion
    , excluded : List BracketReportExcluded
    }


{-| Both views are on offer unless the owner keeps the suggestions private.
-}
hasBothViews : Report -> Bool
hasBothViews r =
    r.suggestionsHidden /= Just True


viewOf : Report -> DeckView -> DeckView
viewOf r requested =
    if hasBothViews r then
        requested

    else
        Current


shown : Report -> DeckView -> Shown
shown r requested =
    case viewOf r requested of
        Optimized ->
            { deck = r.after
            , bracket = Maybe.map (\b -> { rules = b, assessment = b.after }) r.bracket
            , decklist = r.decklist
            , combosPresent = r.combosPresent
            , combosOneAway = r.combosOneAway
            , synergies = Maybe.withDefault [] r.synergies
            , suggested =
                Just
                    { before = r.before
                    , bracketBefore = Maybe.map .before r.bracket
                    , swaps = r.swaps
                    , strategy = r.strategy
                    , edits = Maybe.withDefault [] r.edits
                    , manaSuggestions = Maybe.withDefault [] r.manaSuggestions
                    , excluded = r.bracket |> Maybe.map .excluded |> Maybe.withDefault []
                    }
            }

        Current ->
            let
                names =
                    List.map .name r.original.decklist
            in
            { deck = r.before
            , bracket = Maybe.map (\b -> { rules = b, assessment = b.before }) r.bracket
            , decklist = r.original.decklist
            , combosPresent = r.original.combosPresent
            , combosOneAway = r.original.combosOneAway

            -- The synergies were found for the suggested deck: only those among the submitted cards.
            , synergies = Maybe.withDefault [] r.synergies |> List.filter (\s -> List.all (\n -> List.member n names) s.cards)
            , suggested = Nothing
            }
