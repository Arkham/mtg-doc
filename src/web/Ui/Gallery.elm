module Ui.Gallery exposing (Gallery, current, focus, neighbours, next, position, prev)

{-| A row of things with one of them in view: what the card sheet moves along. There's always one
in view, and moving only goes to one that's there, so no position can fall outside the row.
-}


{-| The ones before the one in view (nearest first), the one in view, and the ones after it.
-}
type Gallery a
    = Gallery (List a) a (List a)


{-| The row with the first that `isIt` in view, if any is.
-}
focus : (a -> Bool) -> List a -> Maybe (Gallery a)
focus isIt =
    let
        walk before items =
            case items of
                [] ->
                    Nothing

                x :: rest ->
                    if isIt x then
                        Just (Gallery before x rest)

                    else
                        walk (x :: before) rest
    in
    walk []


current : Gallery a -> a
current (Gallery _ x _) =
    x


next : Gallery a -> Maybe (Gallery a)
next (Gallery before x after) =
    case after of
        y :: rest ->
            Just (Gallery (x :: before) y rest)

        [] ->
            Nothing


prev : Gallery a -> Maybe (Gallery a)
prev (Gallery before x after) =
    case before of
        y :: rest ->
            Just (Gallery rest y (x :: after))

        [] ->
            Nothing


{-| Where the one in view is, counting from 1, and how many there are.
-}
position : Gallery a -> ( Int, Int )
position (Gallery before _ after) =
    ( List.length before + 1, List.length before + 1 + List.length after )


{-| The ones either side of the one in view.
-}
neighbours : Gallery a -> List a
neighbours (Gallery before _ after) =
    List.take 1 before ++ List.take 1 after
