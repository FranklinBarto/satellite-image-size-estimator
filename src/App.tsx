import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  CssBaseline,
  Divider,
  FormControl,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  Slider,
  Stack,
  TextField,
  ThemeProvider,
  Typography,
  createTheme,
  useMediaQuery,
} from "@mui/material";

import Map from "ol/Map";
import View from "ol/View";
import TileLayer from "ol/layer/Tile";
import VectorLayer from "ol/layer/Vector";
import OSM from "ol/source/OSM";
import VectorSource from "ol/source/Vector";
import Draw from "ol/interaction/Draw";
import Polygon from "ol/geom/Polygon";
import { fromLonLat, toLonLat } from "ol/proj";
import { Style, Stroke, Fill } from "ol/style";

import "ol/ol.css";

// ---------------------------------------------------------------------------
// Design tokens
// ---------------------------------------------------------------------------
// A quiet cartographic-blueprint surface (pale blue-grey, ink-blue structure)
// with a single amber "signal" accent reserved for live data: HUD readouts,
// the pixel-fill gauge, and status indicators. Numbers and coordinates are
// always set in mono to read as instrument output, never as prose.

const INK = "#152238";
const INK_SOFT = "#5C7089";
const HAIRLINE = "#CBD8E6";
const PAPER = "#FFFFFF";
const CANVAS = "#EEF3F8";
const STRUCTURE = "#1E3A5F";
const STRUCTURE_DARK = "#0F2036";
const SIGNAL = "#E2790A";
const SIGNAL_SOFT = "#FBE4C6";

const FONT_DISPLAY = '"Space Grotesk", "IBM Plex Sans", sans-serif';
const FONT_BODY = '"IBM Plex Sans", -apple-system, sans-serif';
const FONT_MONO = '"IBM Plex Mono", ui-monospace, "SFMono-Regular", Menlo, monospace';

const theme = createTheme({
  palette: {
    mode: "light",
    background: { default: CANVAS, paper: PAPER },
    primary: { main: STRUCTURE, dark: STRUCTURE_DARK, light: "#3E6690" },
    divider: HAIRLINE,
    text: { primary: INK, secondary: INK_SOFT },
    error: { main: "#B3261E" },
    warning: { main: SIGNAL },
  },
  shape: { borderRadius: 3 },
  typography: {
    fontFamily: FONT_BODY,
    h5: { fontFamily: FONT_DISPLAY, fontWeight: 600, letterSpacing: "-0.01em" },
    h6: { fontFamily: FONT_DISPLAY, fontWeight: 600, letterSpacing: "-0.01em" },
    subtitle2: { fontFamily: FONT_DISPLAY, fontWeight: 600 },
  },
  components: {
    MuiButton: { styleOverrides: { root: { textTransform: "none", fontWeight: 600 } } },
    MuiTextField: { defaultProps: { size: "small" } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: { backgroundColor: PAPER, borderRadius: 3 },
        notchedOutline: { borderColor: HAIRLINE },
      },
    },
  },
});

// ---------------------------------------------------------------------------
// Domain data
// ---------------------------------------------------------------------------

type DataType = { name: string; bytes: number; min: number; max: number };
type SensorPreset = {
  name: string;
  code: string;
  description: string;
  resolutionX: number;
  resolutionY: number;
  bands: number;
  dataType: string;
  valueMin: number;
  valueMax: number;
  compressionRatio: number;
};

const DATA_TYPES: Record<string, DataType> = {
  UInt8: { name: "UInt8", bytes: 1, min: 0, max: 255 },
  UInt16: { name: "UInt16", bytes: 2, min: 0, max: 65535 },
  Int16: { name: "Int16", bytes: 2, min: -32768, max: 32767 },
  UInt32: { name: "UInt32", bytes: 4, min: 0, max: 4294967295 },
  Int32: { name: "Int32", bytes: 4, min: -2147483648, max: 2147483647 },
  Float32: { name: "Float32", bytes: 4, min: -Infinity, max: Infinity },
  Float64: { name: "Float64", bytes: 8, min: -Infinity, max: Infinity },
};

const PRESETS: Record<string, SensorPreset> = {
  planet_rgb: {
    name: "PlanetScope RGB",
    code: "PS2-RGB",
    description: "3-band RGB visual / analytic-style output (3m)",
    resolutionX: 3,
    resolutionY: 3,
    bands: 3,
    dataType: "UInt16",
    valueMin: 0,
    valueMax: 10000,
    compressionRatio: 2.2,
  },
  planet_multispectral: {
    name: "PlanetScope Multispectral",
    code: "PS2-MS4",
    description: "4-band Blue, Green, Red, and NIR (3m)",
    resolutionX: 3,
    resolutionY: 3,
    bands: 4,
    dataType: "UInt16",
    valueMin: 0,
    valueMax: 10000,
    compressionRatio: 2.5,
  },
  planet_superdove: {
    name: "PlanetScope SuperDove 8-Band",
    code: "SD-MS8",
    description: "8-band multispectral coastal to NIR (3m)",
    resolutionX: 3,
    resolutionY: 3,
    bands: 8,
    dataType: "UInt16",
    valueMin: 0,
    valueMax: 10000,
    compressionRatio: 2.7,
  },
  sentinel2: {
    name: "Sentinel-2 Multispectral",
    code: "S2-MSI",
    description: "10m surface reflectance output (10 bands)",
    resolutionX: 10,
    resolutionY: 10,
    bands: 10,
    dataType: "UInt16",
    valueMin: 0,
    valueMax: 10000,
    compressionRatio: 2.5,
  },
  sentinel1_vvvh: {
    name: "Sentinel-1 IW GRD (VV + VH)",
    code: "S1-SAR2",
    description: "10m dual-pol Synthetic Aperture Radar (SAR)",
    resolutionX: 10,
    resolutionY: 10,
    bands: 2,
    dataType: "Float32",
    valueMin: -35,
    valueMax: 5,
    compressionRatio: 1.8,
  },
  landsat: {
    name: "Landsat 8/9 OLI/TIRS",
    code: "L89-OT",
    description: "30m multispectral + thermal composite",
    resolutionX: 30,
    resolutionY: 30,
    bands: 11,
    dataType: "UInt16",
    valueMin: 0,
    valueMax: 65535,
    compressionRatio: 2.5,
  },
  custom: {
    name: "Custom Sensor",
    code: "CUSTOM",
    description: "User-configured spatial and spectral parameters",
    resolutionX: 10,
    resolutionY: 10,
    bands: 4,
    dataType: "UInt16",
    valueMin: 0,
    valueMax: 10000,
    compressionRatio: 2.0,
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index++;
  }
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[index]}`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatArea(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function bboxDimensionsMeters(minLon: number, minLat: number, maxLon: number, maxLat: number) {
  const R = 6371008.8;
  const lat1 = (minLat * Math.PI) / 180;
  const lat2 = (maxLat * Math.PI) / 180;
  const centerLat = (lat1 + lat2) / 2;
  const deltaLat = Math.abs(lat2 - lat1);
  const deltaLon = Math.abs(((maxLon - minLon) * Math.PI) / 180);
  return {
    width: R * deltaLon * Math.cos(centerLat),
    height: R * deltaLat,
  };
}

// Maps a byte count onto a 0..1 position on a log scale from 1KB to 2TB,
// used to drive the pixel-fill gauge. Purely a visual scale marker.
function gaugeFraction(bytes: number): number {
  const minLog = 3; // 1 KB
  const maxLog = 12.3; // ~2 TB
  const logVal = Math.log10(Math.max(bytes, 1));
  return Math.min(1, Math.max(0, (logVal - minLog) / (maxLog - minLog)));
}

const GAUGE_COLS = 12;
const GAUGE_ROWS = 4;
const GAUGE_CELLS = GAUGE_COLS * GAUGE_ROWS;

// ---------------------------------------------------------------------------
// Small presentational pieces
// ---------------------------------------------------------------------------

function ConsoleLabel({ children }: { children: React.ReactNode }) {
  return (
    <Typography
      component="div"
      sx={{
        fontFamily: FONT_MONO,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.08em",
        color: INK_SOFT,
        textTransform: "uppercase",
        display: "flex",
        alignItems: "center",
        gap: 0.75,
        "&::before": { content: '"›"', color: SIGNAL, fontWeight: 700 },
      }}
    >
      {children}
    </Typography>
  );
}

function StatusDot({ live }: { live: boolean }) {
  return (
    <Stack direction="row" spacing={0.75} alignItems="center">
      <Box
        sx={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          bgcolor: live ? SIGNAL : HAIRLINE,
          boxShadow: live ? `0 0 0 3px ${SIGNAL_SOFT}` : "none",
          transition: "background-color 0.2s ease, box-shadow 0.2s ease",
        }}
      />
      <Typography
        sx={{
          fontFamily: FONT_MONO,
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: "0.1em",
          color: live ? SIGNAL : INK_SOFT,
        }}
      >
        {live ? "LIVE" : "STANDBY"}
      </Typography>
    </Stack>
  );
}

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ display: "flex", alignItems: "baseline", gap: 1 }}>
      <Typography sx={{ fontFamily: FONT_BODY, fontSize: 13, color: INK_SOFT, whiteSpace: "nowrap" }}>
        {label}
      </Typography>
      <Box sx={{ flex: 1, borderBottom: `1px dotted ${HAIRLINE}`, mb: "4px" }} />
      <Typography sx={{ fontFamily: FONT_MONO, fontSize: 13, fontWeight: 600, color: INK, whiteSpace: "nowrap" }}>
        {value}
      </Typography>
    </Box>
  );
}

function CornerBrackets({ color = STRUCTURE }: { color?: string }) {
  const size = 18;
  const thickness = 2;
  const common = {
    position: "absolute" as const,
    width: size,
    height: size,
    pointerEvents: "none" as const,
    zIndex: 6,
  };
  return (
    <>
      <Box sx={{ ...common, top: 10, left: 10, borderTop: `${thickness}px solid ${color}`, borderLeft: `${thickness}px solid ${color}` }} />
      <Box sx={{ ...common, top: 10, right: 10, borderTop: `${thickness}px solid ${color}`, borderRight: `${thickness}px solid ${color}` }} />
      <Box sx={{ ...common, bottom: 10, left: 10, borderBottom: `${thickness}px solid ${color}`, borderLeft: `${thickness}px solid ${color}` }} />
      <Box sx={{ ...common, bottom: 10, right: 10, borderBottom: `${thickness}px solid ${color}`, borderRight: `${thickness}px solid ${color}` }} />
    </>
  );
}

function PixelGauge({ bytes }: { bytes: number }) {
  const fraction = gaugeFraction(bytes);
  const filled = Math.round(fraction * GAUGE_CELLS);
  const cells = Array.from({ length: GAUGE_CELLS }, (_, i) => i < filled);

  return (
    <Box>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: `repeat(${GAUGE_COLS}, 1fr)`,
          gap: "3px",
        }}
      >
        {cells.map((on, i) => (
          <Box
            key={i}
            sx={{
              aspectRatio: "1 / 1",
              bgcolor: on ? SIGNAL : "transparent",
              border: `1px solid ${on ? SIGNAL : HAIRLINE}`,
              transition: "background-color 0.3s ease, border-color 0.3s ease",
            }}
          />
        ))}
      </Box>
      <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.75 }}>
        <Typography sx={{ fontFamily: FONT_MONO, fontSize: 10, color: INK_SOFT, letterSpacing: "0.05em" }}>
          1KB
        </Typography>
        <Typography sx={{ fontFamily: FONT_MONO, fontSize: 10, color: INK_SOFT, letterSpacing: "0.05em" }}>
          SCALE (LOG)
        </Typography>
        <Typography sx={{ fontFamily: FONT_MONO, fontSize: 10, color: INK_SOFT, letterSpacing: "0.05em" }}>
          2TB
        </Typography>
      </Stack>
    </Box>
  );
}

function Panel({
  children,
  sx,
}: {
  children: React.ReactNode;
  sx?: object;
}) {
  return (
    <Box
      sx={{
        bgcolor: PAPER,
        border: `1px solid ${HAIRLINE}`,
        position: "relative",
        ...sx,
      }}
    >
      {children}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  const mapElement = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const vectorSource = useRef(new VectorSource());

  const [preset, setPreset] = useState("planet_multispectral");
  const selectedPreset = PRESETS[preset];

  const [resolutionX, setResolutionX] = useState(selectedPreset.resolutionX);
  const [resolutionY, setResolutionY] = useState(selectedPreset.resolutionY);
  const [bands, setBands] = useState(selectedPreset.bands);
  const [dataType, setDataType] = useState(selectedPreset.dataType);
  const [valueMin, setValueMin] = useState(selectedPreset.valueMin);
  const [valueMax, setValueMax] = useState(selectedPreset.valueMax);
  const [compressionRatio, setCompressionRatio] = useState(selectedPreset.compressionRatio);

  const [bbox, setBbox] = useState<{
    minLon: number;
    minLat: number;
    maxLon: number;
    maxLat: number;
  } | null>(null);

  // Load web fonts for the console typography system.
  useEffect(() => {
    const id = "raster-estimator-fonts";
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap";
    document.head.appendChild(link);
  }, []);

  // Initialize Map
  useEffect(() => {
    if (!mapElement.current) return;

    const vectorLayer = new VectorLayer({
      source: vectorSource.current,
      style: new Style({
        stroke: new Stroke({ color: STRUCTURE, width: 2 }),
        fill: new Fill({ color: "rgba(226, 121, 10, 0.12)" }),
      }),
    });

    const map = new Map({
      target: mapElement.current,
      layers: [new TileLayer({ source: new OSM() }), vectorLayer],
      view: new View({
        center: fromLonLat([36.8, -1.3]),
        zoom: isMobile ? 4 : 6,
      }),
      controls: [],
    });

    const draw = new Draw({
      source: vectorSource.current,
      type: "Circle",
      geometryFunction: (coordinates, geometry) => {
        const start = coordinates[0];
        const end = coordinates[1];
        const polygonCoordinates = [
          [start, [start[0], end[1]], end, [end[0], start[1]], start],
        ];
        if (!geometry) {
          geometry = new Polygon(polygonCoordinates);
        } else {
          geometry.setCoordinates(polygonCoordinates);
        }
        return geometry;
      },
    });

    map.addInteraction(draw);

    draw.on("drawend", (event) => {
      vectorSource.current.clear();
      vectorSource.current.addFeature(event.feature);
      const geometry = event.feature.getGeometry();
      if (!geometry) return;

      const extent = geometry.getExtent();
      const bottomLeft = toLonLat([extent[0], extent[1]]);
      const topRight = toLonLat([extent[2], extent[3]]);

      setBbox({
        minLon: bottomLeft[0],
        minLat: bottomLeft[1],
        maxLon: topRight[0],
        maxLat: topRight[1],
      });
    });

    mapRef.current = map;

    const resizeObserver = new ResizeObserver(() => map.updateSize());
    resizeObserver.observe(mapElement.current);

    return () => {
      resizeObserver.disconnect();
      map.setTarget(undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClearAOI = () => {
    vectorSource.current.clear();
    setBbox(null);
  };

  const applyPreset = (name: string) => {
    const p = PRESETS[name];
    setPreset(name);
    setResolutionX(p.resolutionX);
    setResolutionY(p.resolutionY);
    setBands(p.bands);
    setDataType(p.dataType);
    setValueMin(p.valueMin);
    setValueMax(p.valueMax);
    setCompressionRatio(p.compressionRatio);
  };

  const markCustomIfChanged = () => {
    if (preset !== "custom") setPreset("custom");
  };

  const results = useMemo(() => {
    if (!bbox) return null;

    const dimensions = bboxDimensionsMeters(bbox.minLon, bbox.minLat, bbox.maxLon, bbox.maxLat);
    const pixelWidth = Math.ceil(dimensions.width / (resolutionX || 1));
    const pixelHeight = Math.ceil(dimensions.height / (resolutionY || 1));
    const pixels = pixelWidth * pixelHeight;
    const samples = pixels * (bands || 1);
    const bytesPerSample = DATA_TYPES[dataType]?.bytes || 1;
    const rawBytes = samples * bytesPerSample;
    const estimatedCompressedBytes = rawBytes / (compressionRatio || 1);
    const areaKm2 = (dimensions.width * dimensions.height) / 1_000_000;

    const dataTypeInfo = DATA_TYPES[dataType];
    const rangeValid = dataTypeInfo ? valueMin >= dataTypeInfo.min && valueMax <= dataTypeInfo.max : true;

    return {
      widthMeters: dimensions.width,
      heightMeters: dimensions.height,
      areaKm2,
      pixelWidth,
      pixelHeight,
      pixels,
      samples,
      bytesPerSample,
      rawBytes,
      estimatedCompressedBytes,
      rangeValid,
    };
  }, [bbox, resolutionX, resolutionY, bands, dataType, valueMin, valueMax, compressionRatio]);

  const fieldSx = {
    "& .MuiInputBase-input": { fontFamily: FONT_MONO, fontSize: 13.5 },
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box
        sx={{
          bgcolor: CANVAS,
          minHeight: "100vh",
          backgroundImage: `linear-gradient(${HAIRLINE} 1px, transparent 1px), linear-gradient(90deg, ${HAIRLINE} 1px, transparent 1px)`,
          backgroundSize: "28px 28px",
          backgroundPosition: "-1px -1px",
        }}
      >
        {/* Console header */}
        <Box
          sx={{
            bgcolor: STRUCTURE_DARK,
            color: "#fff",
            px: { xs: 2, sm: 3, md: 4 },
            py: { xs: 1.5, md: 2 },
          }}
        >
          <Stack
            direction={{ xs: "column", sm: "row" }}
            justifyContent="space-between"
            alignItems={{ xs: "flex-start", sm: "center" }}
            spacing={{ xs: 1, sm: 0 }}
          >
            <Box>
              <Stack direction="row" spacing={1.25} alignItems="center" flexWrap="wrap" rowGap={0.5}>
                <Typography
                  sx={{
                    fontFamily: FONT_MONO,
                    fontSize: 11,
                    letterSpacing: "0.12em",
                    color: SIGNAL,
                    border: `1px solid ${SIGNAL}`,
                    px: 0.75,
                    py: 0.15,
                  }}
                >
                  RAS&#8209;EST
                </Typography>
                <Typography
                  variant={isMobile ? "subtitle1" : "h6"}
                  sx={{ fontFamily: FONT_DISPLAY, fontWeight: 600, lineHeight: 1.2 }}
                >
                  Satellite Mosaic Payload Estimator
                </Typography>
              </Stack>
              <Typography
                sx={{
                  fontFamily: FONT_BODY,
                  fontSize: 12.5,
                  color: "rgba(255,255,255,0.6)",
                  mt: 0.5,
                  display: { xs: "none", sm: "block" },
                }}
              >
                Raw and compressed footprint of a raster mosaic, computed from AOI geometry and sensor spec.
              </Typography>
            </Box>

            <Stack direction="row" spacing={2} alignItems="center">
              <Box sx={{ textAlign: "right" }}>
                <Typography sx={{ fontFamily: FONT_MONO, fontSize: 10, letterSpacing: "0.08em", color: "rgba(255,255,255,0.5)" }}>
                  AOI AREA
                </Typography>
                <Typography sx={{ fontFamily: FONT_MONO, fontSize: 16, fontWeight: 600, color: results ? SIGNAL : "rgba(255,255,255,0.4)" }}>
                  {results ? `${formatArea(results.areaKm2)} km²` : "— —"}
                </Typography>
              </Box>
              <StatusDot live={!!bbox} />
            </Stack>
          </Stack>
        </Box>

        <Box sx={{ maxWidth: 1600, mx: "auto", px: { xs: 1.5, sm: 2, md: 4 }, py: { xs: 2, md: 3 } }}>
          <Box
            sx={{
              display: "flex",
              flexDirection: { xs: "column", lg: "row" },
              gap: { xs: 2, md: 3 },
              alignItems: "flex-start",
            }}
          >
            {/* LEFT: Map instrument */}
            <Box sx={{ width: { xs: "100%", lg: "60%" }, flexShrink: 0 }}>
              <Panel sx={{ overflow: "hidden" }}>
                <CornerBrackets />

                {/* HUD readout over the map */}
                <Box sx={{ position: "absolute", top: { xs: 8, sm: 14 }, left: { xs: 8, sm: 14 }, zIndex: 10 }}>
                  <Box sx={{ bgcolor: "rgba(21,34,56,0.88)", backdropFilter: "blur(4px)", px: 1.5, py: 1 }}>
                    <Typography sx={{ fontFamily: FONT_MONO, fontSize: 10, letterSpacing: "0.08em", color: "rgba(255,255,255,0.55)" }}>
                      AOI BOUNDING BOX
                    </Typography>
                    <Typography sx={{ fontFamily: FONT_MONO, fontSize: 15, fontWeight: 600, color: results ? SIGNAL : "#fff" }}>
                      {results ? `${formatArea(results.areaKm2)} km²` : "No region selected"}
                    </Typography>
                  </Box>
                </Box>

                {bbox && (
                  <Button
                    onClick={handleClearAOI}
                    size="small"
                    sx={{
                      position: "absolute",
                      top: { xs: 8, sm: 14 },
                      right: { xs: 8, sm: 14 },
                      zIndex: 10,
                      bgcolor: STRUCTURE_DARK,
                      color: "#fff",
                      fontFamily: FONT_MONO,
                      fontSize: 11,
                      letterSpacing: "0.05em",
                      px: 1.5,
                      "&:hover": { bgcolor: "#B3261E" },
                    }}
                  >
                    ✕ Clear AOI
                  </Button>
                )}

                <Box
                  ref={mapElement}
                  sx={{
                    height: { xs: 320, sm: 440, md: 500, lg: 720 },
                    width: "100%",
                    bgcolor: "#dfe6ee",
                  }}
                />

                <Box sx={{ p: { xs: 1.25, sm: 1.5 }, borderTop: `1px solid ${HAIRLINE}` }}>
                  <Stack
                    direction={{ xs: "column", sm: "row" }}
                    justifyContent="space-between"
                    alignItems={{ xs: "flex-start", sm: "center" }}
                    spacing={0.5}
                  >
                    <Typography sx={{ fontFamily: FONT_MONO, fontSize: 11, color: INK_SOFT }}>
                      {isMobile ? "Drag to draw an AOI" : "Click and drag on the map to draw a rectangular AOI"}
                    </Typography>
                    {bbox && (
                      <Typography sx={{ fontFamily: FONT_MONO, fontSize: 11, color: INK_SOFT, wordBreak: "break-all" }}>
                        [{bbox.minLon.toFixed(3)}, {bbox.minLat.toFixed(3)}, {bbox.maxLon.toFixed(3)}, {bbox.maxLat.toFixed(3)}]
                      </Typography>
                    )}
                  </Stack>
                </Box>
              </Panel>
            </Box>

            {/* RIGHT: Readouts & config */}
            <Box sx={{ width: { xs: "100%", lg: "40%" }, minWidth: 0 }}>
              <Stack spacing={{ xs: 2, md: 2.5 }}>
                {/* Payload readout */}
                <Panel sx={{ p: { xs: 2, sm: 2.5 } }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
                    <ConsoleLabel>Estimated Payload</ConsoleLabel>
                    <StatusDot live={!!bbox} />
                  </Stack>

                  <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
                    <Box sx={{ flex: "1 1 200px" }}>
                      <Typography sx={{ fontFamily: FONT_MONO, fontSize: 10.5, letterSpacing: "0.08em", color: SIGNAL, fontWeight: 600 }}>
                        COMPRESSED
                      </Typography>
                      <Typography
                        sx={{
                          fontFamily: FONT_MONO,
                          fontWeight: 700,
                          fontSize: { xs: 28, sm: 32 },
                          color: INK,
                          lineHeight: 1.15,
                          wordBreak: "break-word",
                        }}
                      >
                        {results ? formatBytes(results.estimatedCompressedBytes) : "—"}
                      </Typography>
                      <Typography sx={{ fontFamily: FONT_MONO, fontSize: 11.5, color: INK_SOFT }}>
                        ratio {compressionRatio.toFixed(1)}:1
                      </Typography>
                    </Box>

                    <Divider orientation="vertical" flexItem sx={{ borderColor: HAIRLINE, display: { xs: "none", sm: "block" } }} />

                    <Box sx={{ flex: "1 1 160px" }}>
                      <Typography sx={{ fontFamily: FONT_MONO, fontSize: 10.5, letterSpacing: "0.08em", color: INK_SOFT, fontWeight: 600 }}>
                        RAW
                      </Typography>
                      <Typography
                        sx={{
                          fontFamily: FONT_MONO,
                          fontWeight: 700,
                          fontSize: { xs: 20, sm: 22 },
                          color: INK,
                          lineHeight: 1.3,
                          wordBreak: "break-word",
                        }}
                      >
                        {results ? formatBytes(results.rawBytes) : "—"}
                      </Typography>
                      <Typography sx={{ fontFamily: FONT_MONO, fontSize: 11.5, color: INK_SOFT }}>
                        {results ? `${formatNumber(results.samples)} samples` : "no AOI"}
                      </Typography>
                    </Box>
                  </Box>

                  <Box sx={{ mt: 2.25 }}>
                    <PixelGauge bytes={results ? results.estimatedCompressedBytes : 0} />
                  </Box>

                  {results && !results.rangeValid && (
                    <Alert severity="error" sx={{ mt: 2, borderRadius: 0 }}>
                      Data range [{valueMin}, {valueMax}] exceeds capacity for <strong>{dataType}</strong>.
                    </Alert>
                  )}
                  {results && results.rawBytes > 10 * 1024 * 1024 * 1024 && (
                    <Alert severity="warning" sx={{ mt: 2, borderRadius: 0 }}>
                      Raw dataset exceeds 10 GB — plan for Cloud-Optimized GeoTIFF (COG) partitioning.
                    </Alert>
                  )}
                </Panel>

                {/* Sensor & grid config */}
                <Panel sx={{ p: { xs: 2, sm: 2.5 } }}>
                  <ConsoleLabel>Sensor &amp; Grid Parameters</ConsoleLabel>

                  <Stack spacing={2} sx={{ mt: 2 }}>
                    <FormControl fullWidth size="small">
                      <InputLabel>Sensor profile</InputLabel>
                      <Select
                        value={preset}
                        label="Sensor profile"
                        onChange={(e) => applyPreset(e.target.value)}
                        sx={{ fontFamily: FONT_MONO, fontSize: 13.5 }}
                        MenuProps={{ PaperProps: { style: { maxHeight: 320 } } }}
                      >
                        {Object.entries(PRESETS).map(([key, value]) => (
                          <MenuItem key={key} value={key} sx={{ fontFamily: FONT_MONO, fontSize: 13.5 }}>
                            {value.code} — {value.name}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>

                    <Typography sx={{ fontFamily: FONT_BODY, fontSize: 12.5, color: INK_SOFT, mt: -1 }}>
                      {selectedPreset.description}
                    </Typography>

                    <Divider sx={{ borderColor: HAIRLINE }} />

                    <ConsoleLabel>Ground sample distance</ConsoleLabel>

                    <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                      <TextField
                        label="Pixel width"
                        type="number"
                        fullWidth
                        value={resolutionX}
                        sx={fieldSx}
                        InputProps={{ endAdornment: <InputAdornment position="end">m</InputAdornment> }}
                        onChange={(e) => {
                          setResolutionX(Number(e.target.value));
                          markCustomIfChanged();
                        }}
                      />
                      <TextField
                        label="Pixel height"
                        type="number"
                        fullWidth
                        value={resolutionY}
                        sx={fieldSx}
                        InputProps={{ endAdornment: <InputAdornment position="end">m</InputAdornment> }}
                        onChange={(e) => {
                          setResolutionY(Number(e.target.value));
                          markCustomIfChanged();
                        }}
                      />
                    </Stack>

                    <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                      <TextField
                        label="Bands / channels"
                        type="number"
                        fullWidth
                        value={bands}
                        sx={fieldSx}
                        onChange={(e) => {
                          setBands(Number(e.target.value));
                          markCustomIfChanged();
                        }}
                      />
                      <FormControl fullWidth size="small">
                        <InputLabel>Data type</InputLabel>
                        <Select
                          value={dataType}
                          label="Data type"
                          sx={{ fontFamily: FONT_MONO, fontSize: 13.5 }}
                          onChange={(e) => {
                            setDataType(e.target.value);
                            markCustomIfChanged();
                          }}
                        >
                          {Object.keys(DATA_TYPES).map((type) => (
                            <MenuItem key={type} value={type} sx={{ fontFamily: FONT_MONO, fontSize: 13.5 }}>
                              {type} ({DATA_TYPES[type].bytes}B)
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Stack>

                    <ConsoleLabel>Pixel range &amp; compression</ConsoleLabel>

                    <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                      <TextField
                        label="Value min"
                        type="number"
                        fullWidth
                        value={valueMin}
                        sx={fieldSx}
                        onChange={(e) => {
                          setValueMin(Number(e.target.value));
                          markCustomIfChanged();
                        }}
                      />
                      <TextField
                        label="Value max"
                        type="number"
                        fullWidth
                        value={valueMax}
                        sx={fieldSx}
                        onChange={(e) => {
                          setValueMax(Number(e.target.value));
                          markCustomIfChanged();
                        }}
                      />
                    </Stack>

                    <Box>
                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Typography sx={{ fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, color: INK }}>
                          Compression ratio
                        </Typography>
                        <Typography sx={{ fontFamily: FONT_MONO, fontSize: 13, fontWeight: 700, color: SIGNAL }}>
                          {compressionRatio.toFixed(1)}×
                        </Typography>
                      </Stack>
                      <Slider
                        min={1}
                        max={10}
                        step={0.1}
                        value={compressionRatio}
                        onChange={(_, value) => {
                          setCompressionRatio(value as number);
                          markCustomIfChanged();
                        }}
                        sx={{
                          mt: 1,
                          color: SIGNAL,
                          "& .MuiSlider-thumb": { borderRadius: 0, width: 14, height: 14 },
                          "& .MuiSlider-rail": { bgcolor: HAIRLINE, opacity: 1 },
                        }}
                      />
                    </Box>
                  </Stack>
                </Panel>

                {/* Breakdown */}
                {results && (
                  <Panel sx={{ p: { xs: 2, sm: 2.5 } }}>
                    <ConsoleLabel>Raster Dimensions</ConsoleLabel>
                    <Stack spacing={1} sx={{ mt: 1.75 }}>
                      <SpecRow label="Dimensions" value={`${formatNumber(results.pixelWidth)} × ${formatNumber(results.pixelHeight)} px`} />
                      <SpecRow label="Total pixels" value={`${formatNumber(results.pixels)} px`} />
                      <SpecRow label="Bytes / sample" value={`${results.bytesPerSample} B`} />
                      <SpecRow
                        label="Ground extent"
                        value={`${(results.widthMeters / 1000).toFixed(2)} × ${(results.heightMeters / 1000).toFixed(2)} km`}
                      />
                    </Stack>
                  </Panel>
                )}
              </Stack>
            </Box>
          </Box>
        </Box>
      </Box>
    </ThemeProvider>
  );
}