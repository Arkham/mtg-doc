module Env exposing (Env, Viewport, decoder)

{-| What the app knows about where it runs, from src/main.ts.
-}

import Json.Decode as D exposing (Decoder)


type alias Viewport =
    { width : Float, height : Float }


type alias Env =
    { isStatic : Bool

    -- Where bundled assets (mana symbols) live.
    , base : String
    , canHover : Bool
    , isTouch : Bool
    , viewport : Viewport
    }


decoder : Decoder Env
decoder =
    D.map5 Env
        (D.field "isStatic" D.bool)
        (D.field "base" D.string)
        (D.field "canHover" D.bool)
        (D.field "isTouch" D.bool)
        (D.field "viewport" (D.map2 Viewport (D.field "width" D.float) (D.field "height" D.float)))
