// Simple script to create placeholder icons
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const iconSizes = [16, 32, 48, 128];
const iconDir = path.join(__dirname, '..', 'src', 'icons');

// Create a simple SVG icon template
const createSVGIcon = (size) => `
<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#1976d2" rx="${size/8}"/>
  <text x="50%" y="60%" text-anchor="middle" fill="white" font-size="${size/3}" font-family="Arial, sans-serif" font-weight="bold">OTP</text>
</svg>
`;

// For now, create simple text files as placeholders
iconSizes.forEach(size => {
  const iconContent = `Placeholder icon ${size}x${size} - Replace with actual PNG`;
  fs.writeFileSync(path.join(iconDir, `icon${size}.png`), iconContent);
});

console.log('Placeholder icons created. Replace with actual PNG files later.');