module Loadable exposing (Loadable(..), map, toMaybe)

{-| Something fetched from the server: on its way, not to be had (and why), or here. One value
instead of a `Maybe` for the data and another for the error, which could both be set.
-}


type Loadable a
    = Loading
    | Unavailable String
    | Loaded a


toMaybe : Loadable a -> Maybe a
toMaybe loadable =
    case loadable of
        Loaded a ->
            Just a

        _ ->
            Nothing


map : (a -> a) -> Loadable a -> Loadable a
map f loadable =
    case loadable of
        Loaded a ->
            Loaded (f a)

        other ->
            other
