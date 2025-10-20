import { createBox, createText } from '@shopify/restyle';
import { Theme } from '../../core/theme'; // Importamos nuestro tipo de tema

// Box es un reemplazo para <View> que acepta propiedades del tema
export const Box = createBox<Theme>();

// Text es un reemplazo para <Text> que acepta propiedades del tema
export const Text = createText<Theme>();
