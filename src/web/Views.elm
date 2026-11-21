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


hasOriginal : Report -> Bool
hasOriginal r =
    r.original /= Nothing


hasBothViews : Report -> Bool
hasBothViews r =
    hasOriginal r && r.suggestionsHidden /= Just True


viewOf : Report -> DeckView -> DeckView
viewOf r requested =
    if r.suggestionsHidden == Just True then
        Current

    else if hasOriginal r then
        requested

    else
        Optimized


{-| The report as it applies to the deck the user submitted: its own stats, list, bracket and
combos, with nothing about swaps.
-}
asOriginal : Report -> Shown
asOriginal r =
    case r.original of
        Nothing ->
            { r = r, single = False }

        Just o ->
            let
                names =
                    List.map .name o.decklist
            in
            { r =
                { r
                    | after = r.before
                    , swaps = []
                    , edits = Just []
                    , manaSuggestions = Just []
                    , decklist = Just o.decklist
                    , combosPresent = o.combosPresent
                    , combosOneAway = o.combosOneAway
                    , synergies = Maybe.map (List.filter (\s -> List.all (\n -> List.member n names) s.cards)) r.synergies
                    , bracket = Maybe.map (\b -> { b | after = b.before, excluded = [] }) r.bracket
                }
            , single = True
            }
