module Request exposing (Request(..), busyWith, failure, isBusy)

{-| Something a page asked the server to do: nothing under way, under way (for what, when it
could be one of several: a swap, a suggestion, a kind of search), or failed, and why. One value
instead of a busy flag and an error that would have to be kept in step.
-}


type Request a
    = Idle
    | Busy a
    | Failed String


isBusy : Request a -> Bool
isBusy request =
    case request of
        Busy _ ->
            True

        _ ->
            False


{-| Under way for this one (of several that each could be).
-}
busyWith : (a -> Bool) -> Request a -> Bool
busyWith this request =
    case request of
        Busy a ->
            this a

        _ ->
            False


failure : Request a -> Maybe String
failure request =
    case request of
        Failed e ->
            Just e

        _ ->
            Nothing
