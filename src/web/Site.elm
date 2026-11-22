module Site exposing (Site(..), decoder)

{-| Where the app runs: the local app with its server, or the published site, read-only, with the
JSON its build exported in place of the API.
-}

import Json.Decode as D exposing (Decoder)


type Site
    = Local
    | Published


{-| From the `isStatic` flag main.ts passes.
-}
decoder : Decoder Site
decoder =
    D.bool
        |> D.map
            (\isStatic ->
                if isStatic then
                    Published

                else
                    Local
            )
