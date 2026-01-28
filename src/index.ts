/**
 * Feedback Intelligence Dashboard - Cloudflare Worker
 * Serves a professional dashboard displaying customer feedback analytics
 * Uses D1 database for persistent storage
 */

interface FeedbackEntry {
	id?: number;
	date: string;
	source: 'Discord' | 'GitHub' | 'Twitter' | 'Support Email';
	message: string;
	sentiment: 'positive' | 'negative' | 'neutral';
	category: 'bug' | 'feature-request' | 'praise' | 'complaint' | 'question';
	urgent: boolean;
}

interface FeedbackInsert {
	source: string;
	message: string;
	sentiment: string;
	category: string;
	urgency: number;
}

interface FeedbackSubmit {
	source: string;
	message: string;
}

interface AIAnalysisResult {
	sentiment: 'positive' | 'negative' | 'neutral';
	category: 'bug' | 'feature-request' | 'praise' | 'complaint' | 'question';
	urgency: number; // 1-5
}

// Fetch all feedback from D1 database
async function fetchFeedbackFromDB(db: D1Database): Promise<FeedbackEntry[]> {
	try {
		const result = await db.prepare(
			'SELECT id, source, message, sentiment, category, urgency, created_at FROM feedback ORDER BY created_at DESC'
		).all<{
			id: number;
			source: string;
			message: string;
			sentiment: string;
			category: string;
			urgency: number;
			created_at: string;
		}>();
		
		if (!result.success) {
			console.error('Database query failed:', result.error);
			return [];
		}
		
		return result.results.map(row => ({
			id: row.id,
			date: row.created_at.split('T')[0],
			source: row.source as FeedbackEntry['source'],
			message: row.message,
			sentiment: row.sentiment as FeedbackEntry['sentiment'],
			category: row.category as FeedbackEntry['category'],
			urgent: row.urgency >= 4, // Urgency 4-5 is considered urgent
		}));
	} catch (error) {
		console.error('Error fetching feedback from database:', error);
		return [];
	}
}

// Analyze feedback using Workers AI
async function analyzeFeedbackWithAI(ai: Ai, message: string): Promise<AIAnalysisResult> {
	const prompt = `Analyze the following customer feedback and provide a JSON response with:
1. sentiment: one of "positive", "negative", or "neutral"
2. category: one of "bug", "feature-request", "praise", "complaint", or "question"
3. urgency: a number from 1-5 where 1 is not urgent and 5 is critical/urgent

Feedback: "${message}"

Respond ONLY with valid JSON in this exact format:
{"sentiment": "positive|negative|neutral", "category": "bug|feature-request|praise|complaint|question", "urgency": 1-5}`;

	try {
		const response = await ai.run('@cf/meta/llama-3.1-8b-instruct-awq', {
			messages: [
				{
					role: 'system',
					content: 'You are a feedback analysis assistant. Always respond with valid JSON only, no additional text.',
				},
				{
					role: 'user',
					content: prompt,
				},
			],
		});

		// Extract JSON from response - handle different response types
		let responseText = '';
		if (typeof response === 'string') {
			responseText = response;
		} else if (response && typeof response === 'object') {
			// Check for common response properties
			const resp = response as any;
			responseText = resp.response || resp.description || resp.text || JSON.stringify(response);
		} else {
			responseText = String(response);
		}
		
		let jsonMatch = responseText.match(/\{[\s\S]*\}/);
		
		if (!jsonMatch) {
			// Try to find JSON in the response
			const lines = responseText.split('\n');
			for (const line of lines) {
				if (line.trim().startsWith('{')) {
					jsonMatch = [line.trim()];
					break;
				}
			}
		}

		if (!jsonMatch) {
			throw new Error('No JSON found in AI response');
		}

		const analysis = JSON.parse(jsonMatch[0]) as AIAnalysisResult;
		
		// Validate and normalize the response
		const validSentiments = ['positive', 'negative', 'neutral'];
		const validCategories = ['bug', 'feature-request', 'praise', 'complaint', 'question'];
		
		if (!validSentiments.includes(analysis.sentiment)) {
			analysis.sentiment = 'neutral';
		}
		
		if (!validCategories.includes(analysis.category)) {
			analysis.category = 'question';
		}
		
		analysis.urgency = Math.max(1, Math.min(5, Math.round(analysis.urgency || 1)));
		
		return analysis;
	} catch (error) {
		console.error('AI analysis error:', error);
		// Return default values on error
		return {
			sentiment: 'neutral',
			category: 'question',
			urgency: 1,
		};
	}
}

// Insert new feedback into D1 database
async function insertFeedbackToDB(db: D1Database, feedback: FeedbackInsert): Promise<{ success: boolean; id?: number; error?: string }> {
	try {
		const result = await db.prepare(
			'INSERT INTO feedback (source, message, sentiment, category, urgency, created_at) VALUES (?, ?, ?, ?, ?, datetime("now"))'
		).bind(
			feedback.source,
			feedback.message,
			feedback.sentiment,
			feedback.category,
			feedback.urgency
		).run();
		
		if (!result.success) {
			return { success: false, error: result.error || 'Unknown database error' };
		}
		
		return { success: true, id: result.meta.last_row_id };
	} catch (error) {
		console.error('Error inserting feedback:', error);
		return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
	}
}

// Calculate summary statistics
function calculateStats(feedback: FeedbackEntry[]) {
	const total = feedback.length;
	const positive = feedback.filter(f => f.sentiment === 'positive').length;
	const negative = feedback.filter(f => f.sentiment === 'negative').length;
	const urgent = feedback.filter(f => f.urgent).length;
	
	return {
		total,
		positivePercent: total > 0 ? Math.round((positive / total) * 100) : 0,
		negativePercent: total > 0 ? Math.round((negative / total) * 100) : 0,
		urgentCount: urgent,
	};
}

// Fetch single feedback entry by ID
async function fetchFeedbackById(db: D1Database, id: number): Promise<FeedbackEntry | null> {
	try {
		const result = await db.prepare(
			'SELECT id, source, message, sentiment, category, urgency, created_at FROM feedback WHERE id = ?'
		).bind(id).first<{
			id: number;
			source: string;
			message: string;
			sentiment: string;
			category: string;
			urgency: number;
			created_at: string;
		}>();
		
		if (!result) {
			return null;
		}
		
		return {
			id: result.id,
			date: result.created_at.split('T')[0],
			source: result.source as FeedbackEntry['source'],
			message: result.message,
			sentiment: result.sentiment as FeedbackEntry['sentiment'],
			category: result.category as FeedbackEntry['category'],
			urgent: result.urgency >= 4,
		};
	} catch (error) {
		console.error('Error fetching feedback by ID:', error);
		return null;
	}
}

// Format category name for display
function formatCategory(category: string): string {
	return category.split('-').map(word => 
		word.charAt(0).toUpperCase() + word.slice(1)
	).join(' ');
}

// Get sentiment badge color
function getSentimentColor(sentiment: string): string {
	switch (sentiment) {
		case 'positive': return 'bg-green-100 text-green-800 border-green-200';
		case 'negative': return 'bg-red-100 text-red-800 border-red-200';
		default: return 'bg-gray-100 text-gray-800 border-gray-200';
	}
}

// Get source badge color
function getSourceColor(source: string): string {
	switch (source) {
		case 'Discord': return 'bg-indigo-100 text-indigo-800';
		case 'GitHub': return 'bg-gray-100 text-gray-800';
		case 'Twitter': return 'bg-blue-100 text-blue-800';
		case 'Support Email': return 'bg-purple-100 text-purple-800';
		default: return 'bg-gray-100 text-gray-800';
	}
}

// Generate HTML dashboard
function generateDashboardHTML(feedback: FeedbackEntry[], stats: ReturnType<typeof calculateStats>): string {
	const tableRows = feedback.map(entry => {
		const truncatedMessage = entry.message.length > 100 
			? entry.message.substring(0, 100) + '...' 
			: entry.message;
		
		return `
			<tr class="hover:bg-purple-50 transition-colors border-b border-purple-100">
				<td class="px-6 py-4 whitespace-nowrap text-sm text-gray-700">${entry.date}</td>
				<td class="px-6 py-4 whitespace-nowrap">
					<span class="px-2 py-1 text-xs font-semibold rounded-full ${getSourceColor(entry.source)}">
						${entry.source}
					</span>
				</td>
				<td class="px-6 py-4 text-sm text-gray-700 max-w-md">${truncatedMessage}</td>
				<td class="px-6 py-4 whitespace-nowrap">
					<span class="px-2 py-1 text-xs font-semibold rounded-full border ${getSentimentColor(entry.sentiment)}">
						${entry.sentiment.charAt(0).toUpperCase() + entry.sentiment.slice(1)}
					</span>
				</td>
				<td class="px-6 py-4 whitespace-nowrap text-sm text-gray-700">${formatCategory(entry.category)}</td>
			</tr>
		`;
	}).join('');
	
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Feedback Intelligence Dashboard</title>
	<script src="https://cdn.tailwindcss.com"></script>
	<style>
		body {
			background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
			min-height: 100vh;
		}
	</style>
</head>
<body class="p-4 md:p-8">
	<div class="max-w-7xl mx-auto">
		<!-- Header -->
		<div class="mb-8">
			<h1 class="text-4xl font-bold text-white mb-2">Feedback Intelligence Dashboard</h1>
			<p class="text-purple-100">Real-time insights from customer feedback across all channels</p>
		</div>
		
		<!-- Feedback Submission Form -->
		<div class="bg-white rounded-lg shadow-lg p-6 mb-8 border-l-4 border-purple-500">
			<h2 class="text-xl font-semibold text-gray-900 mb-4">Submit New Feedback</h2>
			<form id="feedbackForm" class="space-y-4">
				<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
					<div>
						<label for="source" class="block text-sm font-medium text-gray-700 mb-2">Source</label>
						<select id="source" name="source" required class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent">
							<option value="">Select a source</option>
							<option value="Discord">Discord</option>
							<option value="GitHub">GitHub</option>
							<option value="Twitter">Twitter</option>
							<option value="Support Email">Support Email</option>
						</select>
					</div>
					<div>
						<label for="message" class="block text-sm font-medium text-gray-700 mb-2">Feedback Message</label>
						<input type="text" id="message" name="message" required placeholder="Enter your feedback here..." class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent">
					</div>
				</div>
				<div class="flex items-center justify-between">
					<p class="text-sm text-gray-500">AI will automatically analyze sentiment, category, and urgency</p>
					<button type="submit" id="submitBtn" class="px-6 py-2 bg-purple-600 text-white font-semibold rounded-lg hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
						<span id="submitBtnText">Submit Feedback</span>
						<span id="submitBtnLoading" class="hidden">Analyzing...</span>
					</button>
				</div>
				<div id="formError" class="hidden text-red-600 text-sm mt-2"></div>
				<div id="formSuccess" class="hidden text-green-600 text-sm mt-2"></div>
			</form>
		</div>
		
		<!-- Summary Cards -->
		<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
			<!-- Total Feedback Card -->
			<div class="bg-white rounded-lg shadow-lg p-6 border-l-4 border-blue-500">
				<div class="flex items-center justify-between">
					<div>
						<p class="text-gray-500 text-sm font-medium">Total Feedback</p>
						<p class="text-3xl font-bold text-gray-900 mt-2">${stats.total}</p>
					</div>
					<div class="bg-blue-100 rounded-full p-3">
						<svg class="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
						</svg>
					</div>
				</div>
			</div>
			
			<!-- Positive Percentage Card -->
			<div class="bg-white rounded-lg shadow-lg p-6 border-l-4 border-green-500">
				<div class="flex items-center justify-between">
					<div>
						<p class="text-gray-500 text-sm font-medium">Positive Feedback</p>
						<p class="text-3xl font-bold text-gray-900 mt-2">${stats.positivePercent}%</p>
					</div>
					<div class="bg-green-100 rounded-full p-3">
						<svg class="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5"></path>
						</svg>
					</div>
				</div>
			</div>
			
			<!-- Negative Percentage Card -->
			<div class="bg-white rounded-lg shadow-lg p-6 border-l-4 border-red-500">
				<div class="flex items-center justify-between">
					<div>
						<p class="text-gray-500 text-sm font-medium">Negative Feedback</p>
						<p class="text-3xl font-bold text-gray-900 mt-2">${stats.negativePercent}%</p>
					</div>
					<div class="bg-red-100 rounded-full p-3">
						<svg class="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
						</svg>
					</div>
				</div>
			</div>
			
			<!-- Urgent Items Card -->
			<div class="bg-white rounded-lg shadow-lg p-6 border-l-4 border-orange-500">
				<div class="flex items-center justify-between">
					<div>
						<p class="text-gray-500 text-sm font-medium">Urgent Items</p>
						<p class="text-3xl font-bold text-gray-900 mt-2">${stats.urgentCount}</p>
					</div>
					<div class="bg-orange-100 rounded-full p-3">
						<svg class="w-8 h-8 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
						</svg>
					</div>
				</div>
			</div>
		</div>
		
		<!-- Data Table -->
		<div class="bg-white rounded-lg shadow-lg overflow-hidden">
			<div class="px-6 py-4 border-b border-gray-200">
				<h2 class="text-xl font-semibold text-gray-900">Recent Feedback</h2>
				<p class="text-sm text-gray-500 mt-1">All customer feedback entries sorted by date</p>
			</div>
			<div class="overflow-x-auto">
				<table class="min-w-full divide-y divide-gray-200">
					<thead class="bg-purple-50">
						<tr>
							<th class="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Date</th>
							<th class="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Source</th>
							<th class="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Message</th>
							<th class="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Sentiment</th>
							<th class="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Category</th>
						</tr>
					</thead>
					<tbody id="feedbackTableBody" class="bg-white divide-y divide-gray-200">
						${tableRows}
					</tbody>
				</table>
			</div>
		</div>
		
		<!-- Footer -->
		<div class="mt-8 text-center text-purple-100 text-sm">
			<p>Feedback Intelligence Dashboard • Last updated: ${new Date().toLocaleString()}</p>
		</div>
	</div>
	
	<script>
		const feedbackData = ${JSON.stringify(feedback)};
		
		function addFeedbackToTable(feedback) {
			const tbody = document.getElementById('feedbackTableBody');
			const truncatedMessage = feedback.message.length > 100 
				? feedback.message.substring(0, 100) + '...' 
				: feedback.message;
			
			const sentimentColors = {
				'positive': 'bg-green-100 text-green-800 border-green-200',
				'negative': 'bg-red-100 text-red-800 border-red-200',
				'neutral': 'bg-gray-100 text-gray-800 border-gray-200'
			};
			
			const sourceColors = {
				'Discord': 'bg-indigo-100 text-indigo-800',
				'GitHub': 'bg-gray-100 text-gray-800',
				'Twitter': 'bg-blue-100 text-blue-800',
				'Support Email': 'bg-purple-100 text-purple-800'
			};
			
			function formatCategory(category) {
				return category.split('-').map(word => 
					word.charAt(0).toUpperCase() + word.slice(1)
				).join(' ');
			}
			
			const row = document.createElement('tr');
			row.className = 'hover:bg-purple-50 transition-colors border-b border-purple-100';
			row.innerHTML = \`
				<td class="px-6 py-4 whitespace-nowrap text-sm text-gray-700">\${feedback.date}</td>
				<td class="px-6 py-4 whitespace-nowrap">
					<span class="px-2 py-1 text-xs font-semibold rounded-full \${sourceColors[feedback.source] || 'bg-gray-100 text-gray-800'}">
						\${feedback.source}
					</span>
				</td>
				<td class="px-6 py-4 text-sm text-gray-700 max-w-md">\${truncatedMessage}</td>
				<td class="px-6 py-4 whitespace-nowrap">
					<span class="px-2 py-1 text-xs font-semibold rounded-full border \${sentimentColors[feedback.sentiment] || sentimentColors.neutral}">
						\${feedback.sentiment.charAt(0).toUpperCase() + feedback.sentiment.slice(1)}
					</span>
				</td>
				<td class="px-6 py-4 whitespace-nowrap text-sm text-gray-700">\${formatCategory(feedback.category)}</td>
			\`;
			
			tbody.insertBefore(row, tbody.firstChild);
		}
		
		function updateStats() {
			// Reload page to get updated stats
			window.location.reload();
		}
		
		document.getElementById('feedbackForm').addEventListener('submit', async (e) => {
			e.preventDefault();
			
			const submitBtn = document.getElementById('submitBtn');
			const submitBtnText = document.getElementById('submitBtnText');
			const submitBtnLoading = document.getElementById('submitBtnLoading');
			const formError = document.getElementById('formError');
			const formSuccess = document.getElementById('formSuccess');
			const sourceInput = document.getElementById('source');
			const messageInput = document.getElementById('message');
			
			// Reset UI
			formError.classList.add('hidden');
			formSuccess.classList.add('hidden');
			submitBtn.disabled = true;
			submitBtnText.classList.add('hidden');
			submitBtnLoading.classList.remove('hidden');
			
			try {
				const response = await fetch('/api/feedback', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({
						source: sourceInput.value,
						message: messageInput.value,
					}),
				});
				
				const result = await response.json();
				
				if (result.success && result.feedback) {
					// Add to table immediately
					addFeedbackToTable(result.feedback);
					
					// Show success message
					formSuccess.textContent = \`Feedback submitted successfully! Analyzed as: \${result.analysis.sentiment} sentiment, \${result.analysis.category} category, urgency \${result.analysis.urgency}/5\`;
					formSuccess.classList.remove('hidden');
					
					// Reset form
					sourceInput.value = '';
					messageInput.value = '';
					
					// Update stats after a short delay
					setTimeout(updateStats, 1000);
				} else {
					throw new Error(result.error || 'Failed to submit feedback');
				}
			} catch (error) {
				formError.textContent = error.message || 'An error occurred while submitting feedback';
				formError.classList.remove('hidden');
			} finally {
				submitBtn.disabled = false;
				submitBtnText.classList.remove('hidden');
				submitBtnLoading.classList.add('hidden');
			}
		});
	</script>
</body>
</html>`;
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		
		// Handle POST /api/feedback endpoint
		if (request.method === 'POST' && url.pathname === '/api/feedback') {
			try {
				const body = await request.json<FeedbackSubmit>();
				
				// Validate required fields
				if (!body.source || !body.message) {
					return new Response(
						JSON.stringify({ success: false, error: 'Missing required fields: source, message' }),
						{
							status: 400,
							headers: { 
								'Content-Type': 'application/json',
								'Access-Control-Allow-Origin': '*',
							},
						}
					);
				}
				
				// Validate source
				const validSources = ['Discord', 'GitHub', 'Twitter', 'Support Email'];
				if (!validSources.includes(body.source)) {
					return new Response(
						JSON.stringify({ success: false, error: `Invalid source. Must be one of: ${validSources.join(', ')}` }),
						{
							status: 400,
							headers: { 
								'Content-Type': 'application/json',
								'Access-Control-Allow-Origin': '*',
							},
						}
					);
				}
				
				// Use AI to analyze the feedback
				const analysis = await analyzeFeedbackWithAI(env.AI, body.message);
				
				// Insert into database with AI-analyzed results
				const result = await insertFeedbackToDB(env.DB, {
					source: body.source,
					message: body.message,
					sentiment: analysis.sentiment,
					category: analysis.category,
					urgency: analysis.urgency,
				});
				
				if (result.success && result.id) {
					// Fetch the complete entry to return
					const feedbackEntry = await fetchFeedbackById(env.DB, result.id);
					
					return new Response(
						JSON.stringify({ 
							success: true, 
							id: result.id,
							feedback: feedbackEntry,
							analysis: {
								sentiment: analysis.sentiment,
								category: analysis.category,
								urgency: analysis.urgency,
							}
						}),
						{
							status: 201,
							headers: { 
								'Content-Type': 'application/json',
								'Access-Control-Allow-Origin': '*',
							},
						}
					);
				} else {
					return new Response(
						JSON.stringify({ success: false, error: result.error || 'Failed to insert feedback' }),
						{
							status: 500,
							headers: { 
								'Content-Type': 'application/json',
								'Access-Control-Allow-Origin': '*',
							},
						}
					);
				}
			} catch (error) {
				console.error('Error processing feedback:', error);
				return new Response(
					JSON.stringify({ success: false, error: 'Invalid JSON in request body' }),
					{
						status: 400,
						headers: { 
							'Content-Type': 'application/json',
							'Access-Control-Allow-Origin': '*',
						},
					}
				);
			}
		}
		
		// Handle GET /api/feedback/:id endpoint
		if (request.method === 'GET' && url.pathname.startsWith('/api/feedback/')) {
			const id = parseInt(url.pathname.split('/').pop() || '0');
			if (isNaN(id) || id <= 0) {
				return new Response(
					JSON.stringify({ success: false, error: 'Invalid feedback ID' }),
					{
						status: 400,
						headers: { 
							'Content-Type': 'application/json',
							'Access-Control-Allow-Origin': '*',
						},
					}
				);
			}
			
			const feedback = await fetchFeedbackById(env.DB, id);
			if (feedback) {
				return new Response(
					JSON.stringify({ success: true, feedback }),
					{
						headers: { 
							'Content-Type': 'application/json',
							'Access-Control-Allow-Origin': '*',
						},
					}
				);
			} else {
				return new Response(
					JSON.stringify({ success: false, error: 'Feedback not found' }),
					{
						status: 404,
						headers: { 
							'Content-Type': 'application/json',
							'Access-Control-Allow-Origin': '*',
						},
					}
				);
			}
		}
		
		// Handle GET / (dashboard)
		if (request.method === 'GET' && url.pathname === '/') {
			// Fetch feedback from D1 database
			const feedback = await fetchFeedbackFromDB(env.DB);
			
			// Calculate statistics
			const stats = calculateStats(feedback);
			
			// Generate HTML dashboard
			const html = generateDashboardHTML(feedback, stats);
			
			// Return HTML response
			return new Response(html, {
				headers: {
					'Content-Type': 'text/html;charset=UTF-8',
				},
			});
		}
		
		// 404 for other routes
		return new Response('Not Found', { status: 404 });
	},
} satisfies ExportedHandler<Env>;
