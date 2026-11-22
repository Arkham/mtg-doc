module Views exposing (Shown, asOriginal, hasBothViews, viewOf)

{-| The two views of a deck's report: the deck as submitted and the doc's suggested version.
-}

import Route exposing (DeckView(..))
import Types exposing (Report)


{-| A report as one of its views shows it. `single` means there's nothing to compare: it's the
deck as submitted, so `before` and `after` are the same deck.
-}
type alias Shown =
    { r : Report
    , single : Bool
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


{-| The report as it applies to the deck the user submitted: its own stats, list, bracket and
combos, with nothing about swaps.
-}
asOriginal : Report -> Shown
asOriginal r =
    let
        names =
            List.map .name r.original.decklist
    in
    { r =
        { r
            | after = r.before
            , swaps = []
            , edits = Just []
            , manaSuggestions = Just []
            , decklist = r.original.decklist
            , combosPresent = r.original.combosPresent
            , combosOneAway = r.original.combosOneAway
            , synergies = Maybe.map (List.filter (\s -> List.all (\n -> List.member n names) s.cards)) r.synergies
            , bracket = Maybe.map (\b -> { b | after = b.before, excluded = [] }) r.bracket
        }
    , single = True
    }
