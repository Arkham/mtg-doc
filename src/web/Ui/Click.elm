module Ui.Click exposing (unlessWithin)

{-| Clicks that bubble up to a container, minus those that started inside parts of it that handle
their own: the decoder fails for those, so the container's handler doesn't fire and nothing has to
stop the click on its way up.
-}

import Json.Decode as D exposing (Decoder)


{-| A click on the element with class `root`, unless it began inside an element whose tag or one of
whose classes is in `inside`.
-}
unlessWithin : { root : String, inside : List String } -> msg -> Decoder msg
unlessWithin o msg =
    D.field "target" (walk o msg)


walk : { root : String, inside : List String } -> msg -> Decoder msg
walk o msg =
    D.map2 (::)
        (D.oneOf [ D.field "tagName" D.string, D.succeed "" ] |> D.map String.toLower)
        -- SVG elements' className isn't a string.
        (D.oneOf [ D.field "className" D.string, D.succeed "" ] |> D.map String.words)
        |> D.andThen
            (\names ->
                if List.any (\n -> List.member n o.inside) names then
                    D.fail "Handled inside"

                else if List.member o.root names then
                    D.succeed msg

                else
                    D.field "parentElement" (D.lazy (\_ -> walk o msg))
            )
