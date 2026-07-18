import * as React from "react";
import type { View } from "react-native";

export interface QRCodeProps {
  value?: string;
  size?: number;
  color?: string;
  backgroundColor?: string;
  quietZone?: number;
  ecl?: "L" | "M" | "Q" | "H";
  getRef?: React.Ref<View>;
  testID?: string;
}

declare const QRCode: React.FC<QRCodeProps>;

export default QRCode;
