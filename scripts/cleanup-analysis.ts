import fs from 'fs/promises';
import path from 'path';
import { glob } from 'glob';

interface AnalysisResult {
  unusedDependencies: string[];
  unusedCssVariables: string[];
  deadStyles: string[];
}

async function analyzeDependencies(): Promise<AnalysisResult> {
  const result: AnalysisResult = {
    unusedDependencies: [],
    unusedCssVariables: [],
    deadStyles: []
  };

  try {
    // Read package.json
    const packageJson = JSON.parse(await fs.readFile('package.json', 'utf-8'));
    const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
    
    // Check for unused shadcn/Radix dependencies
    const shadcnDeps = Object.keys(dependencies).filter(dep => 
      dep.includes('shadcn') || dep.includes('@radix-ui')
    );
    
    if (shadcnDeps.length > 0) {
      result.unusedDependencies = shadcnDeps;
    }
    
    // Analyze CSS files for unused variables
    const cssFiles = await glob('src/**/*.css');
    
    for (const file of cssFiles) {
      const content = await fs.readFile(file, 'utf-8');
      
      // Find CSS variables
      const varMatches = content.match(/--[^:)]+:/g);
      if (varMatches) {
        result.unusedCssVariables.push(...varMatches.map(m => m.slice(0, -1)));
      }
    }
    
    // Analyze for dead styles
    const tsFiles = await glob('src/**/*.{ts,tsx}');
    
    for (const file of tsFiles) {
      const content = await fs.readFile(file, 'utf-8');
      
      // Look for classNames that might be dead styles
      const classMatches = content.match(/className="[^"]*"/g);
      if (classMatches) {
        result.deadStyles.push(...classMatches);
      }
    }
    
    return result;
  } catch (error) {
    console.error('Analysis failed:', error);
    return result;
  }
}

async function main() {
  console.log('Starting cleanup analysis...');
  
  const results = await analyzeDependencies();
  
  console.log('\n=== Cleanup Analysis Results ===');
  console.log('\nUnused Dependencies:');
  results.unusedDependencies.forEach(dep => console.log(`  - ${dep}`));
  
  console.log('\nPotential Unused CSS Variables:');
  results.unusedCssVariables.forEach(variable => console.log(`  - ${variable}`));
  
  console.log('\nPotential Dead Styles:');
  results.deadStyles.forEach(style => console.log(`  - ${style}`));
  
  console.log('\nAnalysis complete.');
}

if (require.main === module) {
  main();
}

export { analyzeDependencies, AnalysisResult };