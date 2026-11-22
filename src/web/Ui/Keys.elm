module Ui.Keys exposing (choose, onKeys)

{-| Keys as messages, parsed in the decoder: a key with a message gives it, any other fails, so
the page never hears a key it has nothing to do for.
-}

import Json.Decode as D exposing (Decoder)


{-| The message for a key, from those given.
-}
choose : List ( String, msg ) -> String -> Decoder msg
choose keys key =
    case List.filter (\( k, _ ) -> k == key) keys of
        ( _, msg ) :: _ ->
            D.succeed msg

        [] ->
            D.fail ("Nothing to do for " ++ key)


{-| A keyboard event's key (`event.key`) as one of the messages given.
-}
onKeys : List ( String, msg ) -> Decoder msg
onKeys keys =
    D.field "key" D.string |> D.andThen (choose keys)
