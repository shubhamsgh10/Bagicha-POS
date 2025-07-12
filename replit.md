# Bagicha Restaurant POS System

## Overview

This is a comprehensive Restaurant Point of Sale (POS) system built with React and Express. The application provides a complete solution for managing restaurant operations including order management, menu administration, inventory tracking, Kitchen Order Tickets (KOT), billing, and reporting.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite for fast development and optimized builds
- **UI Library**: Radix UI primitives with shadcn/ui components
- **Styling**: Tailwind CSS with custom CSS variables for theming
- **State Management**: TanStack Query (React Query) for server state management
- **Routing**: Wouter for lightweight client-side routing
- **Real-time Communication**: WebSocket integration for live updates

### Backend Architecture
- **Runtime**: Node.js with Express.js framework
- **Language**: TypeScript with ES modules
- **Database**: PostgreSQL with Drizzle ORM
- **Database Provider**: Neon serverless PostgreSQL
- **Session Management**: PostgreSQL-backed sessions with connect-pg-simple
- **WebSocket Server**: Built-in WebSocket server for real-time updates
- **Development**: Hot module replacement with Vite integration

## Key Components

### Database Layer
- **ORM**: Drizzle ORM with TypeScript-first approach
- **Schema**: Centralized schema definitions in `shared/schema.ts`
- **Migrations**: Database migrations managed through Drizzle Kit
- **Connection**: Neon serverless PostgreSQL with connection pooling

### Authentication & Authorization
- **User Management**: Role-based access control (admin, manager, staff)
- **Session Storage**: PostgreSQL-backed sessions for persistence
- **Password Security**: Handled through user authentication system

### Business Logic Components
1. **Order Management**: Complete order lifecycle from creation to completion
2. **Menu Management**: Categories and menu items with pricing and availability
3. **Inventory Tracking**: Stock management with low-stock alerts
4. **KOT System**: Kitchen Order Tickets for restaurant operations
5. **Billing System**: Invoice generation and payment processing
6. **Reporting**: Sales analytics and business intelligence

### UI Components
- **Design System**: Consistent component library based on Radix UI
- **Responsive Design**: Mobile-first approach with touch-friendly interfaces
- **Theme Support**: CSS custom properties for consistent theming
- **Accessibility**: ARIA compliant components with keyboard navigation

## Data Flow

### Client-Server Communication
1. **REST API**: Standard HTTP endpoints for CRUD operations
2. **WebSocket**: Real-time updates for order status changes and notifications
3. **Query Caching**: TanStack Query manages server state caching and synchronization
4. **Error Handling**: Centralized error handling with user-friendly messages

### Real-time Updates
- Order status changes broadcast to all connected clients
- Kitchen notifications for new orders
- Inventory alerts for low stock items
- Live dashboard updates for sales metrics

### Data Persistence
- PostgreSQL database with structured relational data
- Session persistence for user authentication
- Audit trails for order and inventory changes
- Backup and recovery through Neon's managed service

## External Dependencies

### Core Framework Dependencies
- React ecosystem (React, React DOM, React Query)
- Express.js with middleware for API development
- Drizzle ORM for database operations
- Neon serverless PostgreSQL for managed database

### UI and Styling
- Tailwind CSS for utility-first styling
- Radix UI for accessible component primitives
- Lucide React for consistent iconography
- React Hook Form for form management

### Development Tools
- Vite for fast development and building
- TypeScript for type safety
- ESLint and PostCSS for code quality
- Replit-specific plugins for development environment

### Third-party Integrations
- Support for delivery platform integrations (Zomato, Swiggy, Uber Eats)
- WebSocket support for real-time features
- Date manipulation with date-fns library

## Deployment Strategy

### Development Environment
- Vite development server with HMR for rapid development
- Integrated WebSocket server for testing real-time features
- Environment-based configuration for database connections
- Replit-specific development tools and debugging

### Production Build
- Vite builds optimized client-side bundle
- ESBuild compiles server-side code for production
- Static assets served from Express server
- Environment variables for production configuration

### Database Management
- Drizzle migrations for schema changes
- Neon serverless PostgreSQL for scalable database hosting
- Connection pooling for efficient database access
- Automatic backups and monitoring through Neon

### Key Architectural Decisions

1. **Monorepo Structure**: Shared types and schemas between client and server for consistency
2. **TypeScript Throughout**: Full type safety from database to UI components
3. **Serverless Database**: Neon PostgreSQL for managed, scalable database infrastructure
4. **Real-time Features**: WebSocket integration for live restaurant operations
5. **Component-based UI**: Reusable component library for consistent user experience
6. **API-first Design**: RESTful endpoints with proper error handling and validation

The system is designed to handle the fast-paced environment of restaurant operations while maintaining data integrity and providing real-time updates to staff across different roles and responsibilities.