const fs = require('fs-extra');
const path = require('path');
const { marked } = require('marked');
const matter = require('gray-matter');
const glob = require('glob');

// Configuration
const CONFIG = {
  blogsDir: './blogs',
  templateFile: './blog-template.html',
  indexFile: './index.html',
  outputDir: './',
  wordsPerMinute: 250
};

// Parse Obsidian-style frontmatter or standard YAML frontmatter
function parseObsidianFrontmatter(content) {
  // Check for standard YAML frontmatter first
  if (content.startsWith('---')) {
    try {
      const parsed = matter(content);
      return {
        frontmatter: parsed.data,
        content: parsed.content
      };
    } catch (error) {
      console.warn('Failed to parse YAML frontmatter, trying Obsidian format');
    }
  }
  
  // Parse Obsidian property format
  const lines = content.split('\n');
  const frontmatter = {};
  let contentStartIndex = 0;
  let inFrontmatter = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Skip empty lines at the start
    if (!line && !inFrontmatter) continue;
    
    // Check for property-style frontmatter
    if (line.includes(':') && !inFrontmatter) {
      inFrontmatter = true;
    }
    
    if (inFrontmatter) {
      // Parse properties
      if (line.includes(':')) {
        const [key, ...valueParts] = line.split(':');
        let value = valueParts.join(':').trim();
        
        // Clean up the key
        const cleanKey = key.trim().toLowerCase();
        
        // Handle different property formats
        if (cleanKey === 'created') {
          // Convert "August 21st 2025" to "2025-08-21"
          const dateMatch = value.match(/(\w+)\s+(\d+)\w*\s+(\d+)/);
          if (dateMatch) {
            const months = {
              'january': '01', 'february': '02', 'march': '03', 'april': '04',
              'may': '05', 'june': '06', 'july': '07', 'august': '08',
              'september': '09', 'october': '10', 'november': '11', 'december': '12'
            };
            const month = months[dateMatch[1].toLowerCase()];
            const day = dateMatch[2].padStart(2, '0');
            const year = dateMatch[3];
            if (month) {
              frontmatter.date = `${year}-${month}-${day}`;
            }
          } else {
            frontmatter.date = value;
          }
        } else if (cleanKey === 'author') {
          frontmatter.author = value;
        } else if (cleanKey === 'tags') {
          // Skip tags line, we'll handle the next line
          continue;
        } else if (line.startsWith('  - ') || line.startsWith('- ')) {
          // Handle tag items (skip for now)
          continue;
        } else {
          // Use the key as-is for other properties
          frontmatter[cleanKey] = value;
        }
      } else if (line.startsWith('#') || (!line.includes(':') && line.length > 0 && !line.startsWith('  -') && !line.startsWith('- '))) {
        // We've hit the content
        contentStartIndex = i;
        break;
      }
    } else if (line.startsWith('#')) {
      // We've hit content without finding frontmatter
      contentStartIndex = i;
      break;
    }
  }
  
  // Extract title from first heading if not in frontmatter
  const contentLines = lines.slice(contentStartIndex);
  const markdownContent = contentLines.join('\n').trim();
  
  if (!frontmatter.title) {
    const titleMatch = markdownContent.match(/^#\s+(.+)$/m);
    if (titleMatch) {
      frontmatter.title = titleMatch[1].trim();
    }
  }
  
  return {
    frontmatter,
    content: markdownContent
  };
}

// Calculate reading time
function calculateReadTime(content) {
  const words = content.trim().split(/\s+/).length;
  const minutes = Math.ceil(words / CONFIG.wordsPerMinute);
  return `${minutes} min read`;
}

// Format date for display
function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

// Create URL-friendly slug from title
function createSlug(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

// Process a single markdown file
async function processBlogPost(filePath) {
  try {
    console.log(`Processing: ${filePath}`);
    
    // Read markdown file
    const markdownContent = await fs.readFile(filePath, 'utf8');
    
    // Parse frontmatter and content (handles both YAML and Obsidian formats)
    const { frontmatter, content: blogContent } = parseObsidianFrontmatter(markdownContent);
    
    // Validate required frontmatter
    if (!frontmatter.title || !frontmatter.date || !frontmatter.author) {
      console.warn(`Skipping ${filePath}: Missing required frontmatter (title, date, author)`);
      console.warn('Found frontmatter:', frontmatter);
      return null;
    }
    
    // Convert markdown to HTML
    const htmlContent = marked(content);
    
    // Calculate reading time
    const readTime = calculateReadTime(content);
    
    // Read template
    const template = await fs.readFile(CONFIG.templateFile, 'utf8');
    
    // Replace template variables
    const finalHtml = template
      .replace(/\{\{title\}\}/g, frontmatter.title)
      .replace(/\{\{author\}\}/g, frontmatter.author)
      .replace(/\{\{date\}\}/g, formatDate(frontmatter.date))
      .replace(/\{\{readTime\}\}/g, readTime)
      .replace(/\{\{content\}\}/g, htmlContent);
    
    // Create output filename
    const slug = createSlug(frontmatter.title);
    const outputPath = path.join(CONFIG.outputDir, `${slug}.html`);
    
    // Write the HTML file
    await fs.writeFile(outputPath, finalHtml);
    
    console.log(`✅ Created: ${outputPath}`);
    
    // Return blog post metadata for index update
    return {
      title: frontmatter.title,
      date: frontmatter.date,
      author: frontmatter.author,
      readTime: readTime,
      filename: `${slug}.html`,
      excerpt: frontmatter.excerpt || content.substring(0, 150).replace(/[#*`]/g, '').trim() + '...'
    };
    
  } catch (error) {
    console.error(`Error processing ${filePath}:`, error.message);
    return null;
  }
}

// Update the main index.html with new blog posts
async function updateIndex(blogPosts) {
  try {
    console.log('Updating index.html...');
    
    // Sort posts by date (newest first)
    const sortedPosts = blogPosts.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    // Generate blog cards HTML
    const blogCardsHtml = sortedPosts.map(post => {
      const formattedDate = formatDate(post.date);
      return `            <a href="${post.filename}" class="blog-card">
                <h2>${post.title}</h2>
                <p>${post.excerpt}</p>
                <div class="date">${formattedDate}</div>
            </a>`;
    }).join('\n\n');
    
    // Read current index.html
    let indexContent = await fs.readFile(CONFIG.indexFile, 'utf8');
    
    // Find and replace the blog section
    const blogSectionStart = '<section class="blog-grid" id="blog">';
    const blogSectionEnd = '</section>';
    
    const startIndex = indexContent.indexOf(blogSectionStart);
    const endIndex = indexContent.indexOf(blogSectionEnd, startIndex) + blogSectionEnd.length;
    
    if (startIndex === -1 || endIndex === -1) {
      throw new Error('Could not find blog section in index.html');
    }
    
    const newBlogSection = `${blogSectionStart}
${blogCardsHtml}
        ${blogSectionEnd}`;
    
    // Replace the blog section
    const updatedContent = indexContent.substring(0, startIndex) + 
                          newBlogSection + 
                          indexContent.substring(endIndex);
    
    // Write updated index.html
    await fs.writeFile(CONFIG.indexFile, updatedContent);
    
    console.log('✅ Updated index.html');
    
  } catch (error) {
    console.error('Error updating index.html:', error.message);
  }
}

// Main function
async function main() {
  try {
    console.log('🚀 Starting blog build process...');
    
    // Find all markdown files in blogs directory
    const markdownFiles = glob.sync(`${CONFIG.blogsDir}/**/*.md`);
    
    if (markdownFiles.length === 0) {
      console.log('No markdown files found in blogs directory');
      return;
    }
    
    console.log(`Found ${markdownFiles.length} markdown file(s)`);
    
    // Process each markdown file
    const blogPosts = [];
    for (const file of markdownFiles) {
      const result = await processBlogPost(file);
      if (result) {
        blogPosts.push(result);
      }
    }
    
    if (blogPosts.length > 0) {
      // Update index.html with new blog posts
      await updateIndex(blogPosts);
      
      console.log(`\n✅ Blog build complete! Generated ${blogPosts.length} blog post(s)`);
    } else {
      console.log('No valid blog posts to process');
    }
    
  } catch (error) {
    console.error('Build failed:', error.message);
    process.exit(1);
  }
}

// Run the script
main();
