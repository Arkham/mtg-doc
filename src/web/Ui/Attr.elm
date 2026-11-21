module Ui.Attr exposing (alt, class, href, id, max, min, optionValue, placeholder, rel, src, target, title, type_, valueAttr)

{-| Attributes set as HTML attributes rather than DOM properties. When the virtual DOM reuses an
element and an attribute goes away, it's removed; a property would be blanked instead, leaving
`class=""` or `href=""` behind.
-}

import Html exposing (Attribute)
import Html.Attributes exposing (attribute)


class : String -> Attribute msg
class =
    attribute "class"


id : String -> Attribute msg
id =
    attribute "id"


href : String -> Attribute msg
href =
    attribute "href"


src : String -> Attribute msg
src =
    attribute "src"


alt : String -> Attribute msg
alt =
    attribute "alt"


title : String -> Attribute msg
title =
    attribute "title"


placeholder : String -> Attribute msg
placeholder =
    attribute "placeholder"


target : String -> Attribute msg
target =
    attribute "target"


rel : String -> Attribute msg
rel =
    attribute "rel"


type_ : String -> Attribute msg
type_ =
    attribute "type"


min : String -> Attribute msg
min =
    attribute "min"


max : String -> Attribute msg
max =
    attribute "max"


{-| An option's value. As a property it would be set before the option has its text, when the
browser already reports that value, so it would never be written.
-}
optionValue : String -> Attribute msg
optionValue =
    attribute "value"


{-| A text field's value as an attribute too, as React kept it (selectors like
`input[value="Sol Ring"]` find the field). The property, set alongside, is what the field shows.
-}
valueAttr : String -> Attribute msg
valueAttr =
    attribute "value"
