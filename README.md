# Rolando Lagmay Jr. — Personal Portfolio

A responsive personal portfolio featuring professional experience, software projects, photo-editing work, a Blender animation, certificates, and PDF resumes.

## Features

- Connected LΛN personal brand
- Real portfolio portraits and capstone social preview
- Responsive dark/light interface
- Clickable project cards and Blender video player
- Filterable fullscreen photo-editing gallery
- PDF resume preview and download
- Firebase-ready admin page for cloud content updates
- Free GitHub Pages publishing

See `SETUP.md` for step-by-step instructions.

## July 2026 interface fixes
- Photo editing cards now use individual before-and-after samples and open in a full-size modal.
- Resume choices now open in a popup modal instead of occupying a panel at the bottom of the page.
- Light-mode contrast was improved throughout the site.
- The About photo now uses `object-fit: contain` so the full portrait is visible.
- Facebook, LinkedIn, GitHub, email, and telephone links are functional.
- Responsive breakpoints were improved for tablets, narrow browser windows, and phones.


## Portfolio V2 Final Changes
- Uses the real black-suit Hero portrait already included in the project.
- Uses the real About portrait already included in the project.
- Uses Rolando's real OJT photograph for IT Support & Maintenance.
- Uses a custom collage created from the real Photo Editing gallery samples.
- Photo Editing samples now open in a browsable fullscreen viewer.
- Supports Previous/Next buttons, keyboard arrows, Escape to close, and mobile swipe.
- Gallery and project grids automatically fill the available width.
- Keeps the working resume selection and PDF preview flow.
- Does not include Fiverr.
- Does not include skill percentages or a repetitive standalone skillset section.


## Final build
- Clear Hero wording.
- About contact details removed.
- Updated Photo Editor resume included.
- Six HD gallery views per editing category.
- Clean phone-gallery-style fullscreen viewer with no title, description, screenshot frame, or black information panel.
- Previous/Next, keyboard arrows, swipe, zoom, and image counter included.
- Clean Photo Editing project collage without the black strip.


## Final carousel behavior
- The original six unique Before-and-After category samples are retained.
- Repeated cropped versions were removed.
- Samples display in one horizontal carousel.
- Right and left arrow buttons appear only when more content exists in that direction.
- The right button disappears at the end; the left button disappears at the beginning.
- Trackpad, mouse wheel, keyboard arrows, mobile swipe, and arrow buttons are supported.
- Clicking a sample opens a clean fullscreen viewer.
- Fullscreen Previous/Next buttons also disappear at the first and last sample.
- Additional genuinely unique Before-and-After files can be added to `content.js` later without changing the carousel code.


## Final fixed build
- Photo Editing contains 20 unique Before/After samples, not repeated crops of one image.
- Category filters use the same horizontal carousel.
- No duplicate “All Editing Samples” section exists underneath.
- Clicking View Full opens an in-page modal; it never opens another browser tab.
- Blender Watch Animation opens an in-page HTML5 video player.
- The original 4K H.264/AAC MP4 is included at assets/videos/blender-animation.mp4.


## About photo fix
- Removed the dark-mode black padding around the About Me portrait.
- Removed the light-mode gray padding around the portrait.
- The photo now fills its rounded container using a consistent 4:5 portrait ratio.


## Final Photo Editing project cover
- Replaced the old Photo Editing Portfolio project image.
- Uses the uploaded six-category collage:
  Portrait Retouching, Product Editing, Background Removal,
  Color Correction, Thumbnail Design, and AI-Assisted Editing.
- The project card is visually connected to the gallery categories.


## Gallery replacement
- Replaced the old Photo Editing gallery images.
- The gallery now uses the six category images cropped directly from the user's uploaded collage.
- Project cover and gallery are now visually connected.
- Old sample images are no longer referenced by content.js.


## Final user-supplied Photo Editing gallery
- Imported every image from `Picture sample.zip` without adding, deleting, duplicating, cropping, or re-exporting any sample.
- Portrait Retouching: 6
- Product Editing: 6
- Background Removal: 5
- Color Correction: 5
- Thumbnail Design: 5
- AI-Assisted Editing: 5
- Total: 32
- The All filter shows all 32 samples; each category filter shows its exact supplied count.
- The existing horizontal carousel and in-page full-size viewer remain enabled.
